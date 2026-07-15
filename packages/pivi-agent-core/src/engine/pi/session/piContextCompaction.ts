import type { AgentMessage } from '@earendil-works/pi-agent-core';

import {
  calculateContextEnvelope,
  type UsageInfo,
} from '../../../foundation';
import {
  type ArtifactReference,
  type Checkpoint,
  CHECKPOINT_SCHEMA_VERSION,
  mergeCheckpoints,
  parsePiviCompactionDetails,
} from '../../../session/continuationSchemas';
import type { SessionTreeStore } from './sessionTreeStore';

export type PiContextCompactionEntry = ReturnType<SessionTreeStore['getEntries']>[number];

export interface PiContextCompactionCutPoint {
  firstKeptEntryId: string;
  prefixEntries: PiContextCompactionEntry[];
  tokensBefore: number;
}

export interface AutoCompactionDecisionInput {
  enableAutoCompact?: boolean;
  compactionInFlight: boolean;
  sessionLeafId: string | null;
  lastAttemptLeafId: string | null;
  providerUsage: UsageInfo;
  storedConversationTokens: number;
  thresholdRatio?: number;
}

export const COMPACTION_SYSTEM_PROMPT = `You are currently performing context compaction for Pivi before the next chat turn continues.
Use exactly these Markdown sections in order: Continuation summary, Goal, Constraints, Decisions, Artifacts, Open work, Unresolved questions, and Next steps.
Preserve durable facts, the current user goal, constraints, decisions made, files/notes/tools touched, important tool results, unresolved questions, and concrete next steps.
Use bullet lists except for Continuation summary and Goal. For Artifacts, write each item as "- label :: vault-relative-path" or "- label"; never include an absolute device path.
Write "None" for a section with no supported information.
Do not add new facts. Be concise but specific enough that the next assistant can continue safely.`;

export const COMPACTION_SUMMARY_PREFIX = 'The earlier session history was compacted. Use this summary as authoritative context for the omitted earlier turns:';
export const DEFAULT_COMPACTION_CONTEXT_WINDOW = 200_000;

const DEFAULT_KEEP_RECENT_TOKENS = 20_000;
const MIN_KEEP_RECENT_TOKENS = 1_000;
const MAX_KEEP_RECENT_TOKENS = 200_000;

const ASCII_PROSE_CHARS_PER_TOKEN = 4;
const ASCII_STRUCTURED_CHARS_PER_TOKEN = 3;

function looksStructured(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.includes('```') || trimmed.includes('~~~')) {
    return true;
  }
  if (!(
    (trimmed.startsWith('{') && trimmed.endsWith('}'))
    || (trimmed.startsWith('[') && trimmed.endsWith(']'))
  )) {
    return false;
  }
  try {
    JSON.parse(trimmed);
    return true;
  } catch {
    return false;
  }
}

/**
 * Conservative tokenizer-independent estimate. CJK and other non-ASCII text
 * is charged per code point, while code/JSON uses a denser ASCII ratio than
 * prose. Provider-reported usage remains authoritative whenever available.
 */
export function estimateTextTokens(text: string): number {
  if (!text) {
    return 0;
  }

  let asciiChars = 0;
  let nonAsciiTokens = 0;
  for (const character of text) {
    if (character.codePointAt(0)! <= 0x7f) {
      asciiChars += 1;
    } else {
      // Astral symbols commonly split into multiple model tokens.
      nonAsciiTokens += character.length === 2 ? 2 : 1;
    }
  }
  const charsPerToken = looksStructured(text)
    ? ASCII_STRUCTURED_CHARS_PER_TOKEN
    : ASCII_PROSE_CHARS_PER_TOKEN;
  return Math.max(1, Math.ceil(asciiChars / charsPerToken) + nonAsciiTokens);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function textFromContent(content: unknown): string {
  if (typeof content === 'string') {
    return content;
  }
  if (!Array.isArray(content)) {
    return '';
  }
  return content.map((part) => {
    if (!isRecord(part)) return '';
    if (part.type === 'text' && typeof part.text === 'string') return part.text;
    if (part.type === 'thinking' && typeof part.thinking === 'string') return `[thinking]\n${part.thinking}`;
    if (part.type === 'toolCall') {
      const name = typeof part.name === 'string' ? part.name : 'tool';
      return `[tool call: ${name}] ${JSON.stringify(part.arguments ?? {})}`;
    }
    return '';
  }).filter(Boolean).join('\n');
}

function textFromAgentMessage(message: AgentMessage): string {
  const record = message as unknown as Record<string, unknown>;
  return textFromContent(record.content);
}

function estimateStructuredValueTokens(value: unknown): number {
  if (typeof value === 'string') {
    return estimateTextTokens(value) + 1;
  }
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) {
    return 1;
  }
  if (Array.isArray(value)) {
    return 2 + value.reduce<number>(
      (total, item: unknown) => total + estimateStructuredValueTokens(item),
      0,
    );
  }
  if (isRecord(value)) {
    return 2 + Object.entries(value).reduce(
      (total, [key, item]) => total + estimateTextTokens(key) + 1 + estimateStructuredValueTokens(item),
      0,
    );
  }
  return 1;
}

export function estimateAgentMessageTokens(message: AgentMessage): number {
  const record = message as unknown as Record<string, unknown>;
  const content = record.content;
  let tokens = 4; // role and message framing

  if (typeof content === 'string') {
    tokens += estimateTextTokens(content);
  } else if (Array.isArray(content)) {
    for (const part of content) {
      if (!isRecord(part)) {
        continue;
      }
      if (part.type === 'text' && typeof part.text === 'string') {
        tokens += estimateTextTokens(part.text);
      } else if (part.type === 'thinking' && typeof part.thinking === 'string') {
        tokens += 2 + estimateTextTokens(part.thinking);
      } else if (part.type === 'toolCall') {
        tokens += 12;
        if (typeof part.name === 'string') {
          tokens += estimateTextTokens(part.name);
        }
        tokens += estimateStructuredValueTokens(part.arguments ?? {});
      } else if (part.type === 'image') {
        // Exact image token cost is provider-specific; retain a safe envelope.
        tokens += 256;
      }
    }
  }

  if (record.role === 'toolResult') {
    tokens += 12;
    if (typeof record.toolName === 'string') {
      tokens += estimateTextTokens(record.toolName);
    }
  }
  return tokens;
}

function isMessageEntry(
  entry: PiContextCompactionEntry,
): entry is PiContextCompactionEntry & { type: 'message'; message: AgentMessage } {
  return entry.type === 'message' && 'message' in entry;
}

function isCompactionEntry(
  entry: PiContextCompactionEntry,
): entry is PiContextCompactionEntry & { type: 'compaction'; summary: string } {
  return entry.type === 'compaction'
    && typeof (entry as unknown as { summary?: unknown }).summary === 'string';
}

function estimateEntryTokens(entry: PiContextCompactionEntry): number {
  if (!isMessageEntry(entry)) {
    return 0;
  }
  return estimateAgentMessageTokens(entry.message);
}

function estimateContextEntryTokens(entry: PiContextCompactionEntry): number {
  if (isCompactionEntry(entry)) {
    return estimateTextTokens(entry.summary);
  }
  return estimateEntryTokens(entry);
}

export function estimateAgentMessagesTokens(messages: AgentMessage[]): number {
  return messages.reduce((total, message) => total + estimateAgentMessageTokens(message), 0);
}

/** Incremental estimates and prefix sums for one append-oriented session view. */
export class PiContextTokenIndex {
  private entries: PiContextCompactionEntry[] = [];
  private entryTokens: number[] = [];
  private entryIndexById = new Map<string, number>();
  private prefixTokens: number[] = [0];

  sync(entries: PiContextCompactionEntry[]): void {
    const previousLength = this.entries.length;
    let unchangedPrefix: number;
    if (
      previousLength > 0
      && entries.length >= previousLength
      && this.entries[previousLength - 1] === entries[previousLength - 1]
    ) {
      unchangedPrefix = previousLength;
    } else if (
      entries.length > 0
      && entries.length < previousLength
      && this.entries[entries.length - 1] === entries[entries.length - 1]
    ) {
      unchangedPrefix = entries.length;
    } else {
      unchangedPrefix = 0;
      const sharedLength = Math.min(previousLength, entries.length);
      while (
        unchangedPrefix < sharedLength
        && this.entries[unchangedPrefix] === entries[unchangedPrefix]
      ) {
        unchangedPrefix += 1;
      }
    }

    for (let index = unchangedPrefix; index < previousLength; index++) {
      const previousEntry = this.entries[index];
      if (previousEntry) {
        this.entryIndexById.delete(previousEntry.id);
      }
    }

    this.entries = entries.slice();
    this.entryTokens.length = unchangedPrefix;
    this.prefixTokens.length = unchangedPrefix + 1;
    for (let index = unchangedPrefix; index < entries.length; index++) {
      const entry = entries[index];
      const tokens = entry ? estimateContextEntryTokens(entry) : 0;
      this.entryTokens[index] = tokens;
      this.prefixTokens[index + 1] = (this.prefixTokens[index] ?? 0) + tokens;
      if (entry) {
        this.entryIndexById.set(entry.id, index);
      }
    }
  }

  indexOfEntry(entryId: string): number {
    return this.entryIndexById.get(entryId) ?? -1;
  }

  tokensAt(index: number): number {
    return this.entryTokens[index] ?? 0;
  }

  tokensBetween(start: number, end = this.entries.length): number {
    const boundedStart = Math.max(0, Math.min(start, this.entries.length));
    const boundedEnd = Math.max(boundedStart, Math.min(end, this.entries.length));
    return (this.prefixTokens[boundedEnd] ?? 0) - (this.prefixTokens[boundedStart] ?? 0);
  }
}

function activeContextTokensFromLatestCompaction(
  entries: PiContextCompactionEntry[],
  tokenIndex: PiContextTokenIndex,
  latestCompactionIndex: number,
): number {
  if (latestCompactionIndex < 0) {
    return tokenIndex.tokensBetween(0);
  }

  const compaction = entries[latestCompactionIndex] as PiContextCompactionEntry & {
    firstKeptEntryId?: unknown;
  };
  const firstKeptIndex = typeof compaction.firstKeptEntryId === 'string'
    ? tokenIndex.indexOfEntry(compaction.firstKeptEntryId)
    : -1;
  const keptTokens = firstKeptIndex >= 0 && firstKeptIndex < latestCompactionIndex
    ? tokenIndex.tokensBetween(firstKeptIndex, latestCompactionIndex)
    : 0;
  return keptTokens + tokenIndex.tokensBetween(latestCompactionIndex);
}

export function estimateActiveContextTokens(
  entries: PiContextCompactionEntry[],
  tokenIndex = new PiContextTokenIndex(),
): number {
  tokenIndex.sync(entries);
  let latestCompactionIndex = -1;
  for (let index = entries.length - 1; index >= 0; index--) {
    if (entries[index] && isCompactionEntry(entries[index]!)) {
      latestCompactionIndex = index;
      break;
    }
  }
  return activeContextTokensFromLatestCompaction(entries, tokenIndex, latestCompactionIndex);
}

function roleForSummary(message: AgentMessage): string {
  const role = (message as unknown as Record<string, unknown>).role;
  return typeof role === 'string' ? role : 'message';
}

function truncateForSummary(text: string, maxChars: number): string {
  if (text.length <= maxChars) {
    return text;
  }
  const head = text.slice(0, Math.floor(maxChars * 0.65));
  const tail = text.slice(text.length - Math.floor(maxChars * 0.25));
  return `${head}\n...[truncated ${text.length - head.length - tail.length} chars]...\n${tail}`;
}

export function stripCompactCommand(text: string): string | undefined {
  const instructions = text.trim().replace(/^\/compact(?:\s|$)/i, '').trim();
  return instructions || undefined;
}

export function getCompactionThresholdTokens(
  contextWindow = DEFAULT_COMPACTION_CONTEXT_WINDOW,
  thresholdRatio?: number,
  contextWindowIsAuthoritative = false,
  outputTokenLimit?: number,
): number {
  return calculateContextEnvelope({
    contextWindow,
    contextWindowIsAuthoritative,
    outputTokenLimit,
    thresholdRatio,
  }).compactionTriggerTokens;
}

export function normalizeCompactionKeepRecentTokens(keepRecentTokens?: number): number {
  return Math.min(
    MAX_KEEP_RECENT_TOKENS,
    Math.max(MIN_KEEP_RECENT_TOKENS, keepRecentTokens ?? DEFAULT_KEEP_RECENT_TOKENS),
  );
}

export function shouldAutoCompact(input: AutoCompactionDecisionInput): boolean {
  if (!input.enableAutoCompact || input.compactionInFlight) {
    return false;
  }

  if (!input.sessionLeafId || input.lastAttemptLeafId === input.sessionLeafId) {
    return false;
  }

  const envelope = calculateContextEnvelope({
    contextWindow: input.providerUsage.contextWindow || DEFAULT_COMPACTION_CONTEXT_WINDOW,
    contextWindowIsAuthoritative: input.providerUsage.contextWindowIsAuthoritative,
    outputTokenLimit: input.providerUsage.outputTokenLimit,
    providerContextTokens: input.providerUsage.contextTokensIsAuthoritative
      ? input.providerUsage.contextTokens
      : undefined,
    recentConversation: input.storedConversationTokens,
    thresholdRatio: input.thresholdRatio,
  });
  return envelope.pressureInputTokens > envelope.compactionTriggerTokens;
}

export function selectCompactionCutPoint(
  entries: PiContextCompactionEntry[],
  keepRecentTokens?: number,
  tokenIndex = new PiContextTokenIndex(),
): PiContextCompactionCutPoint | null {
  tokenIndex.sync(entries);
  let latestCompactionIndex = -1;
  for (let index = entries.length - 1; index >= 0; index--) {
    const entry = entries[index];
    if (entry && isCompactionEntry(entry)) {
      latestCompactionIndex = index;
      break;
    }
  }

  const messageEntries = entries
    .slice(latestCompactionIndex + 1)
    .filter(isMessageEntry);
  if (messageEntries.length < 4) {
    return null;
  }

  let keptTokens = 0;
  let firstKeptIndex = -1;
  for (let i = entries.length - 1; i >= 0; i--) {
    if (i <= latestCompactionIndex) {
      break;
    }
    const entry = entries[i];
    if (!entry || !isMessageEntry(entry)) {
      continue;
    }
    keptTokens += tokenIndex.tokensAt(i);
    firstKeptIndex = i;
    if (keptTokens >= normalizeCompactionKeepRecentTokens(keepRecentTokens)) {
      break;
    }
  }

  if (firstKeptIndex <= latestCompactionIndex + 1) {
    return null;
  }

  const firstKept = entries[firstKeptIndex];
  if (!firstKept || !isMessageEntry(firstKept)) {
    return null;
  }

  const prefixEntries = entries
    .slice(Math.max(0, latestCompactionIndex), firstKeptIndex)
    .filter((entry) => isMessageEntry(entry) || isCompactionEntry(entry));
  const tokensBefore = activeContextTokensFromLatestCompaction(
    entries,
    tokenIndex,
    latestCompactionIndex,
  );
  if (prefixEntries.length < 2) {
    return null;
  }

  return {
    firstKeptEntryId: firstKept.id,
    prefixEntries,
    tokensBefore,
  };
}

export function buildCompactionPrompt(
  prefixEntries: PiContextCompactionEntry[],
  instructions?: string,
): string {
  const lines = prefixEntries.map((entry, index) => {
    if (isCompactionEntry(entry)) {
      const content = truncateForSummary(entry.summary, 8_000);
      return `## ${index + 1}. previous compaction summary\n${content}`;
    }
    if (!isMessageEntry(entry)) {
      return '';
    }
    const role = roleForSummary(entry.message);
    const content = truncateForSummary(textFromAgentMessage(entry.message), 4_000);
    return `## ${index + 1}. ${role}\n${content}`;
  }).filter(Boolean);

  const customInstructions = instructions
    ? `\n\nUser focus for this compaction:\n${instructions}`
    : '';
  const history = truncateForSummary(lines.join('\n\n'), 120_000);
  return `You are doing context compaction now. Summarize the following earlier session history so the next assistant turn can continue with less context.
Return exactly these Markdown sections in this order: ## Continuation summary, ## Goal, ## Constraints, ## Decisions, ## Artifacts, ## Open work, ## Unresolved questions, ## Next steps. Use bullet lists except for Continuation summary and Goal. For Artifacts, use "- label :: vault-relative-path" or "- label" and never include an absolute device path. Use "None" when the history does not support a section.${customInstructions}\n\n${history}`;
}

export function buildCompactionSummary(summaryText: string): string {
  return `${COMPACTION_SUMMARY_PREFIX}\n\n${summaryText.trim()}`;
}

interface ParsedCheckpointSections {
  continuationSummary: string;
  goal: string | null;
  constraints: string[];
  decisions: string[];
  artifacts: ArtifactReference[];
  openWork: string[];
  unresolvedQuestions: string[];
  nextSteps: string[];
}

const CHECKPOINT_SECTION_NAMES = [
  'Continuation summary',
  'Goal',
  'Constraints',
  'Decisions',
  'Artifacts',
  'Open work',
  'Unresolved questions',
  'Next steps',
] as const;

function parseCheckpointSections(text: string): Map<string, string> | null {
  const sections = new Map<string, string>();
  const headingPattern = /^##\s+(.+?)\s*$/gm;
  const headings = [...text.matchAll(headingPattern)];
  for (let index = 0; index < headings.length; index++) {
    const heading = headings[index];
    if (!heading) {
      continue;
    }
    const name = heading[1]?.trim();
    if (!name || !CHECKPOINT_SECTION_NAMES.includes(name as typeof CHECKPOINT_SECTION_NAMES[number])) {
      continue;
    }
    const start = (heading.index ?? 0) + heading[0].length;
    const end = headings[index + 1]?.index ?? text.length;
    sections.set(name, text.slice(start, end).trim());
  }
  return CHECKPOINT_SECTION_NAMES.every((name) => sections.has(name)) ? sections : null;
}

function parseListSection(value: string): string[] {
  if (/^none[.!]?$/i.test(value.trim())) {
    return [];
  }
  return value.split('\n').map((line) => line.replace(/^\s*[-*]\s+/, '').trim())
    .filter((line) => line && !/^none[.!]?$/i.test(line));
}

function parseArtifactSection(value: string): ArtifactReference[] {
  return parseListSection(value).map((item) => {
    const separator = item.indexOf('::');
    if (separator < 0) {
      return { label: item };
    }
    return {
      label: item.slice(0, separator).trim(),
      vaultPath: item.slice(separator + 2).trim(),
    };
  });
}

function parseCompactionCheckpointSections(text: string): ParsedCheckpointSections | null {
  const sections = parseCheckpointSections(text);
  if (!sections) {
    return null;
  }
  const continuationSummary = sections.get('Continuation summary')?.trim() ?? '';
  const goalText = sections.get('Goal')?.trim() ?? '';
  if (!continuationSummary || /^none[.!]?$/i.test(continuationSummary)) {
    return null;
  }
  return {
    continuationSummary,
    goal: /^none[.!]?$/i.test(goalText) ? null : goalText,
    constraints: parseListSection(sections.get('Constraints') ?? ''),
    decisions: parseListSection(sections.get('Decisions') ?? ''),
    artifacts: parseArtifactSection(sections.get('Artifacts') ?? ''),
    openWork: parseListSection(sections.get('Open work') ?? ''),
    unresolvedQuestions: parseListSection(sections.get('Unresolved questions') ?? ''),
    nextSteps: parseListSection(sections.get('Next steps') ?? ''),
  };
}

export function findLatestCheckpoint(entries: PiContextCompactionEntry[]): Checkpoint | null {
  for (let index = entries.length - 1; index >= 0; index--) {
    const entry = entries[index];
    if (!entry || !isCompactionEntry(entry)) {
      continue;
    }
    const details = parsePiviCompactionDetails(
      (entry as unknown as { details?: unknown }).details,
    );
    if (details) {
      return details.piviCheckpoint;
    }
  }
  return null;
}

export function buildCheckpoint(
  summaryText: string,
  cutPoint: PiContextCompactionCutPoint,
  previous: Checkpoint | null,
): Checkpoint | null {
  const sections = parseCompactionCheckpointSections(summaryText);
  const first = cutPoint.prefixEntries[0];
  const last = cutPoint.prefixEntries.at(-1);
  if (!sections || !first || !last) {
    return null;
  }
  const checkpoint = parsePiviCompactionDetails({
    piviCheckpoint: {
      schemaVersion: CHECKPOINT_SCHEMA_VERSION,
      ...sections,
      source: {
        firstEntryId: first.id,
        lastEntryId: last.id,
        firstKeptEntryId: cutPoint.firstKeptEntryId,
      },
      tokenEstimates: {
        contextBefore: cutPoint.tokensBefore,
        checkpoint: estimateTextTokens(summaryText),
      },
    },
  })?.piviCheckpoint ?? null;
  if (!checkpoint) {
    return null;
  }
  const merged = mergeCheckpoints(previous, checkpoint);
  return {
    ...merged,
    tokenEstimates: {
      ...merged.tokenEstimates,
      checkpoint: estimateTextTokens(renderCheckpoint(merged)),
    },
  };
}

function renderList(values: readonly string[]): string {
  return values.length > 0 ? values.map((value) => `- ${value}`).join('\n') : 'None';
}

export function renderCheckpoint(checkpoint: Checkpoint): string {
  const artifacts = checkpoint.artifacts.length > 0
    ? checkpoint.artifacts.map((artifact) => (
      `- ${artifact.label}${artifact.vaultPath ? ` :: ${artifact.vaultPath}` : ''}`
    )).join('\n')
    : 'None';
  return [
    '## Continuation summary',
    checkpoint.continuationSummary,
    '## Goal',
    checkpoint.goal ?? 'None',
    '## Constraints',
    renderList(checkpoint.constraints),
    '## Decisions',
    renderList(checkpoint.decisions),
    '## Artifacts',
    artifacts,
    '## Open work',
    renderList(checkpoint.openWork),
    '## Unresolved questions',
    renderList(checkpoint.unresolvedQuestions),
    '## Next steps',
    renderList(checkpoint.nextSteps),
  ].join('\n\n');
}

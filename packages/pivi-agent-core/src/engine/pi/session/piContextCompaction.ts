import type { AgentMessage } from '@earendil-works/pi-agent-core';
import {
  buildContextEntries,
  convertToLlm,
  estimateTokens as estimatePiMessageTokens,
  findCutPoint,
  sessionEntryToContextMessages,
} from '@earendil-works/pi-coding-agent';

import {
  calculateContextEnvelope,
  type CheckpointPresentation,
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

export { AUTO_COMPACTION_THRESHOLD_RATIO } from '../../../foundation';

export type PiContextCompactionEntry = ReturnType<SessionTreeStore['getEntries']>[number];

export interface PiContextCompactionPlan {
  activeEntries: PiContextCompactionEntry[];
  prefixEntries: PiContextCompactionEntry[];
  prefixFingerprint: string;
  prefixMessages: AgentMessage[];
  tailEntries: PiContextCompactionEntry[];
  tailMessages: AgentMessage[];
  tokensBefore: number;
}

export interface AutoCompactionDecisionInput {
  compactionInFlight: boolean;
  failedFingerprint: string | null;
  sessionFingerprint: string;
  sessionLeafId: string | null;
  providerUsage: UsageInfo;
  storedConversationTokens: number;
}

export interface CompactionDraft {
  continuationSummary: string;
  goal: string | null;
  constraints: string[];
  decisions: string[];
  artifacts: ArtifactReference[];
  openWork: string[];
  unresolvedQuestions: string[];
  nextSteps: string[];
}

export const COMPACTION_PREFIRE_LEAD_RATIO = 0.1;
export const COMPACTION_PREFIX_RATIO = 0.95;
export const MIN_COMPACTION_MESSAGE_ENTRIES = 4;
export const MIN_COMPACTION_NOTE_TOKENS = 128;
export const COMPACTION_PROMPT_VERSION = 'pivi-vault-two-pass-v1';

export const COMPACTION_SYSTEM_PROMPT = `You create continuation notes for a durable Obsidian vault conversation.
Use only facts supported by the supplied conversation. Preserve the user's current objective, constraints, decisions, exact wikilinks, vault-relative note paths, dates, verified tool successes and failures, unresolved questions, and concrete next steps.
Never expose an absolute device path, hidden reasoning, credentials, or unsupported inference.
Return exactly one fenced pivi-checkpoint JSON object with these fields:
continuationSummary (string), goal (string or null), constraints (string[]), decisions (string[]), artifacts ({label:string,vaultPath?:string}[]), openWork (string[]), unresolvedQuestions (string[]), nextSteps (string[]).
Use empty arrays when no supported items exist. Do not include prose outside the fence.`;

export const COMPACTION_SUMMARY_PREFIX = 'The earlier session history was compacted. Use this summary as authoritative context for the omitted earlier turns:';
export const DEFAULT_COMPACTION_CONTEXT_WINDOW = 200_000;

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
  return Math.max(tokens, estimatePiMessageTokens(message));
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

export function toCheckpointPresentation(
  checkpoint: Checkpoint,
): CheckpointPresentation {
  return {
    artifacts: checkpoint.artifacts.map((artifact) => ({ ...artifact })),
    constraints: [...checkpoint.constraints],
    continuationSummary: checkpoint.continuationSummary,
    decisions: [...checkpoint.decisions],
    goal: checkpoint.goal,
    nextSteps: [...checkpoint.nextSteps],
    openWork: [...checkpoint.openWork],
    source: { ...checkpoint.source },
    tokenEstimate: checkpoint.tokenEstimates.checkpoint,
    unresolvedQuestions: [...checkpoint.unresolvedQuestions],
  };
}

export interface PiContextCategoryEstimates {
  checkpoints: number;
  recentConversation: number;
  toolAndAgentResults: number;
}

function addMessageCategory(
  estimates: PiContextCategoryEstimates,
  message: AgentMessage,
): void {
  const tokens = estimateAgentMessageTokens(message);
  const role = (message as unknown as { role?: unknown }).role;
  if (role === 'toolResult') {
    estimates.toolAndAgentResults += tokens;
    return;
  }
  estimates.recentConversation += tokens;
}

export function estimateAgentMessageCategories(
  messages: AgentMessage[],
): PiContextCategoryEstimates {
  const estimates: PiContextCategoryEstimates = {
    checkpoints: 0,
    recentConversation: 0,
    toolAndAgentResults: 0,
  };
  for (const message of messages) {
    addMessageCategory(estimates, message);
  }
  return estimates;
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

export function estimateActiveContextCategories(
  entries: PiContextCompactionEntry[],
): PiContextCategoryEstimates {
  const estimates: PiContextCategoryEstimates = {
    checkpoints: 0,
    recentConversation: 0,
    toolAndAgentResults: 0,
  };
  for (const entry of buildContextEntries(entries)) {
    if (isCompactionEntry(entry)) {
      estimates.checkpoints += estimateTextTokens(entry.summary);
      continue;
    }
    for (const message of sessionEntryToContextMessages(entry)) {
      addMessageCategory(estimates, message);
    }
  }
  return estimates;
}

export function stripCompactCommand(text: string): string | undefined {
  const instructions = text.trim().replace(/^\/compact(?:\s|$)/i, '').trim();
  return instructions || undefined;
}

export function getCompactionThresholdTokens(
  contextWindow = DEFAULT_COMPACTION_CONTEXT_WINDOW,
  contextWindowIsAuthoritative = false,
  outputTokenLimit?: number,
): number {
  return calculateContextEnvelope({
    contextWindow,
    contextWindowIsAuthoritative,
    outputTokenLimit,
  }).compactionTriggerTokens;
}

export function getCompactionPrefireTokens(
  hardTriggerTokens: number,
  contextWindow = DEFAULT_COMPACTION_CONTEXT_WINDOW,
): number {
  return Math.max(0, hardTriggerTokens - Math.floor(contextWindow * COMPACTION_PREFIRE_LEAD_RATIO));
}

export function shouldAutoCompact(input: AutoCompactionDecisionInput): boolean {
  if (input.compactionInFlight) {
    return false;
  }

  if (!input.sessionLeafId || input.failedFingerprint === input.sessionFingerprint) {
    return false;
  }

  if (input.providerUsage.contextEnvelope) {
    return input.providerUsage.contextEnvelope.pressureInputTokens
      >= input.providerUsage.contextEnvelope.compactionTriggerTokens;
  }

  const envelope = calculateContextEnvelope({
    contextWindow: input.providerUsage.contextWindow || DEFAULT_COMPACTION_CONTEXT_WINDOW,
    contextWindowIsAuthoritative: input.providerUsage.contextWindowIsAuthoritative,
    outputTokenLimit: input.providerUsage.outputTokenLimit,
    providerContextTokens: input.providerUsage.contextTokensIsAuthoritative
      ? input.providerUsage.contextTokens
      : undefined,
    recentConversation: input.storedConversationTokens,
  });
  return envelope.pressureInputTokens >= envelope.compactionTriggerTokens;
}

const DEVICE_PATH_IN_TEXT = /(?:file:\/\/\/|[A-Za-z]:[\\/]|\\\\[^\\\s]+\\|\/(?:Users|home|private|tmp|var|Volumes)\/)\S*/gi;
const GENERIC_ABSOLUTE_PATH_IN_TEXT = /(?<![A-Za-z0-9_.:/-])\/(?:(?:[^/\s"'`<>]+\/)+[^/\s"'`<>]+|[^/\s"'`<>]+\.[A-Za-z0-9]+)/g;

function redactDevicePaths(text: string): string {
  return text
    .replace(DEVICE_PATH_IN_TEXT, '[external path omitted]')
    .replace(GENERIC_ABSOLUTE_PATH_IN_TEXT, '[external path omitted]');
}

function sanitizeStructuredValue(value: unknown): unknown {
  if (typeof value === 'string') {
    return redactDevicePaths(value);
  }
  if (Array.isArray(value)) {
    return value.map(sanitizeStructuredValue);
  }
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, sanitizeStructuredValue(item)]),
    );
  }
  return value;
}

/** Remove reasoning and device-local paths while preserving conversation/tool evidence. */
export function sanitizeCompactionMessage(message: AgentMessage): AgentMessage {
  const record = message as unknown as Record<string, unknown>;
  let content: unknown;
  if (typeof record.content === 'string') {
    content = redactDevicePaths(record.content);
  } else if (Array.isArray(record.content)) {
    content = record.content.flatMap((part) => {
      if (!isRecord(part) || part.type === 'thinking') {
        return [];
      }
      if (part.type === 'image') {
        return [{ type: 'text', text: '[image attachment omitted from compaction input]' }];
      }
      if (part.type === 'text' && typeof part.text === 'string') {
        return [{ ...part, text: redactDevicePaths(part.text) }];
      }
      if (part.type === 'toolCall') {
        return [{
          ...part,
          arguments: sanitizeStructuredValue(part.arguments ?? {}),
        }];
      }
      return [sanitizeStructuredValue(part)];
    });
  } else {
    content = [];
  }
  return {
    ...record,
    content,
  } as unknown as AgentMessage;
}

function messageForEntry(entry: PiContextCompactionEntry): AgentMessage | null {
  const projected = sessionEntryToContextMessages(entry);
  const message = projected[0] as AgentMessage | undefined;
  return message ? sanitizeCompactionMessage(message) : null;
}

function contextItems(entries: PiContextCompactionEntry[]): Array<{
  entry: PiContextCompactionEntry;
  message: AgentMessage;
  tokens: number;
}> {
  return entries.flatMap((entry) => {
    if (!isMessageEntry(entry) && !isCompactionEntry(entry)) {
      return [];
    }
    const message = messageForEntry(entry);
    return message ? [{
      entry,
      message,
      tokens: estimateAgentMessageTokens(message),
    }] : [];
  });
}

export function compactionMessagesFromEntries(
  entries: PiContextCompactionEntry[],
): AgentMessage[] {
  return contextItems(entries).map((item) => item.message);
}

function stableFingerprint(value: unknown): string {
  const text = JSON.stringify(value);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `${text.length}:${(hash >>> 0).toString(16)}`;
}

export function fingerprintCompactionEntries(entries: PiContextCompactionEntry[]): string {
  return stableFingerprint(contextItems(entries).map(({ entry, message }) => ({
    id: entry.id,
    message,
  })));
}

export function buildCompactionPlan(
  activeEntries: PiContextCompactionEntry[],
): PiContextCompactionPlan | null {
  const items = contextItems(activeEntries);
  const messageEntryCount = activeEntries.filter(isMessageEntry).length;
  if (messageEntryCount < MIN_COMPACTION_MESSAGE_ENTRIES || items.length < 2) {
    return null;
  }
  const tokensBefore = items.reduce((total, item) => total + item.tokens, 0);
  const targetTailTokens = Math.max(
    1,
    Math.ceil(tokensBefore * (1 - COMPACTION_PREFIX_RATIO)),
  );
  let desiredSplitIndex = items.length - 1;
  let accumulatedTailTokens = 0;
  for (let index = items.length - 1; index >= 0; index--) {
    accumulatedTailTokens += items[index]?.tokens ?? 0;
    desiredSplitIndex = index;
    if (accumulatedTailTokens >= targetTailTokens) {
      break;
    }
  }
  const keepRecentTokens = Math.max(
    1,
    items.slice(desiredSplitIndex).reduce(
      (total, item) => total + estimatePiMessageTokens(item.message),
      0,
    ),
  );
  const cutPoint = findCutPoint(
    items.map((item) => item.entry),
    0,
    items.length,
    keepRecentTokens,
  );
  const splitIndex = Math.max(
    1,
    Math.min(cutPoint.firstKeptEntryIndex, items.length - 1),
  );

  const prefix = items.slice(0, splitIndex);
  const tail = items.slice(splitIndex);
  if (prefix.length === 0 || tail.length === 0) {
    return null;
  }
  const prefixEntries = prefix.map((item) => item.entry);
  return {
    activeEntries: items.map((item) => item.entry),
    prefixEntries,
    prefixFingerprint: fingerprintCompactionEntries(prefixEntries),
    prefixMessages: prefix.map((item) => item.message),
    tailEntries: tail.map((item) => item.entry),
    tailMessages: tail.map((item) => item.message),
    tokensBefore,
  };
}

/** Pi's canonical AgentMessage-to-LLM conversion, preserving role/tool structure. */
export function convertCompactionMessages(
  messages: AgentMessage[],
): ReturnType<typeof convertToLlm> {
  return convertToLlm(messages);
}

export function buildPass1Prompt(): string {
  return `Create NOTE₁ from the conversation prefix already present in your context.
NOTE₁ is an internal, self-contained vault continuation draft for a later finalization pass.
Preserve durable facts and evidence; omit conversational filler and hidden reasoning.`;
}

export function buildPass2Prompt(instructions?: string): string {
  const focus = instructions
    ? `\nThe user supplied this focus for the final NOTE₂ only:\n${redactDevicePaths(instructions)}\n`
    : '';
  return `Create the final NOTE₂ from NOTE₁ and the original recent conversation already present in your context.
Reconcile the recent raw messages with NOTE₁, giving newer explicit user decisions priority.
NOTE₂ must stand alone because it will replace the complete active model context.${focus}`;
}

export function buildFallbackPrompt(instructions?: string): string {
  const focus = instructions
    ? `\nThe user supplied this focus for the final NOTE₂:\n${redactDevicePaths(instructions)}\n`
    : '';
  return `Create the final self-contained NOTE₂ from the complete active conversation already present in your context.
This is the single-pass fallback; preserve all continuation-critical vault facts and reconcile later decisions.${focus}`;
}

export function buildNote1Carrier(note1: string): AgentMessage {
  return {
    role: 'user',
    content: `<pivi_note_1>\n${note1.trim()}\n</pivi_note_1>`,
    timestamp: Date.now(),
  } as unknown as AgentMessage;
}

export function buildCompactionSummary(summaryText: string): string {
  return `${COMPACTION_SUMMARY_PREFIX}\n\n${summaryText.trim()}`;
}

function containsDevicePath(value: unknown): boolean {
  if (typeof value === 'string') {
    DEVICE_PATH_IN_TEXT.lastIndex = 0;
    GENERIC_ABSOLUTE_PATH_IN_TEXT.lastIndex = 0;
    return DEVICE_PATH_IN_TEXT.test(value)
      || GENERIC_ABSOLUTE_PATH_IN_TEXT.test(value);
  }
  if (Array.isArray(value)) {
    return value.some(containsDevicePath);
  }
  return isRecord(value) && Object.values(value).some(containsDevicePath);
}

function extractCheckpointJson(text: string): unknown {
  const pattern = /(?:^|\n)```pivi-checkpoint\s*\n([\s\S]*?)\n```(?=\n|$)/gi;
  let candidate: unknown = null;
  for (const match of text.matchAll(pattern)) {
    try {
      candidate = JSON.parse(match[1] ?? '');
    } catch {
      candidate = null;
    }
  }
  return candidate;
}

export function parseCompactionDraft(text: string): CompactionDraft | null {
  const value = extractCheckpointJson(text);
  if (!isRecord(value) || containsDevicePath(value)) {
    return null;
  }
  const checkpoint = parsePiviCompactionDetails({
    piviCheckpoint: {
      schemaVersion: CHECKPOINT_SCHEMA_VERSION,
      ...value,
      source: {
        firstEntryId: 'draft-first',
        lastEntryId: 'draft-last',
        firstKeptEntryId: 'draft-boundary',
      },
      tokenEstimates: {
        contextBefore: 0,
        checkpoint: 0,
      },
    },
  })?.piviCheckpoint;
  if (!checkpoint) {
    return null;
  }
  const draft: CompactionDraft = {
    continuationSummary: checkpoint.continuationSummary,
    goal: checkpoint.goal,
    constraints: checkpoint.constraints,
    decisions: checkpoint.decisions,
    artifacts: checkpoint.artifacts,
    openWork: checkpoint.openWork,
    unresolvedQuestions: checkpoint.unresolvedQuestions,
    nextSteps: checkpoint.nextSteps,
  };
  return estimateTextTokens(renderCompactionDraft(draft)) >= MIN_COMPACTION_NOTE_TOKENS
    ? draft
    : null;
}

export function renderCompactionDraft(draft: CompactionDraft): string {
  return renderCheckpoint({
    schemaVersion: CHECKPOINT_SCHEMA_VERSION,
    ...draft,
    source: {
      firstEntryId: 'draft-first',
      lastEntryId: 'draft-last',
      firstKeptEntryId: 'draft-boundary',
    },
    tokenEstimates: {
      contextBefore: 0,
      checkpoint: 0,
    },
  });
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
  draft: CompactionDraft,
  plan: PiContextCompactionPlan,
  previous: Checkpoint | null,
  firstKeptEntryId = 'pending-compaction-boundary',
): Checkpoint | null {
  const first = plan.activeEntries[0];
  const last = plan.activeEntries.at(-1);
  if (!first || !last) {
    return null;
  }
  const checkpoint = parsePiviCompactionDetails({
    piviCheckpoint: {
      schemaVersion: CHECKPOINT_SCHEMA_VERSION,
      ...draft,
      source: {
        firstEntryId: first.id,
        lastEntryId: last.id,
        firstKeptEntryId,
      },
      tokenEstimates: {
        contextBefore: plan.tokensBefore,
        checkpoint: estimateTextTokens(renderCompactionDraft(draft)),
      },
    },
  })?.piviCheckpoint ?? null;
  if (!checkpoint) {
    return null;
  }
  const merged = mergeCheckpoints(previous, checkpoint);
  if (containsDevicePath(merged)) {
    return null;
  }
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

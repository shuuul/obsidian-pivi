import type { AgentMessage } from '@earendil-works/pi-agent-core';

import type { UsageInfo } from '../../../foundation';
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
You summarize a long agent coding session for future continuation.
Preserve durable facts, current user goal, decisions made, files/notes/tools touched, important tool results, unresolved questions, and next steps.
Do not add new facts. Be concise but specific enough that the next assistant can continue safely.`;

export const COMPACTION_SUMMARY_PREFIX = 'The earlier session history was compacted. Use this summary as authoritative context for the omitted earlier turns:';
export const DEFAULT_COMPACTION_CONTEXT_WINDOW = 200_000;

const DEFAULT_KEEP_RECENT_TOKENS = 20_000;
const MIN_KEEP_RECENT_TOKENS = 1_000;
const MAX_KEEP_RECENT_TOKENS = 200_000;

export function estimateTextTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
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
  return estimateTextTokens(textFromAgentMessage(entry.message));
}

function estimateContextEntryTokens(entry: PiContextCompactionEntry): number {
  if (isCompactionEntry(entry)) {
    return estimateTextTokens(entry.summary);
  }
  return estimateEntryTokens(entry);
}

export function estimateAgentMessagesTokens(messages: AgentMessage[]): number {
  return messages.reduce((total, message) => total + estimateTextTokens(textFromAgentMessage(message)), 0);
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
): number {
  const ratio = Math.min(0.95, Math.max(0.5, thresholdRatio ?? 0.9));
  return Math.floor(contextWindow * ratio);
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

  const contextWindow = input.providerUsage.contextWindow > 0
    ? input.providerUsage.contextWindow
    : DEFAULT_COMPACTION_CONTEXT_WINDOW;
  const thresholdTokens = getCompactionThresholdTokens(contextWindow, input.thresholdRatio);
  const decisionTokens = Math.max(input.providerUsage.contextTokens, input.storedConversationTokens);
  return decisionTokens > thresholdTokens;
}

export function selectCompactionCutPoint(
  entries: PiContextCompactionEntry[],
  keepRecentTokens?: number,
): PiContextCompactionCutPoint | null {
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
    keptTokens += estimateEntryTokens(entry);
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
  const activeContextEntries = entries.slice(Math.max(0, latestCompactionIndex));
  const tokensBefore = activeContextEntries.reduce(
    (total, entry) => total + estimateContextEntryTokens(entry),
    0,
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
  return `You are doing context compaction now. Summarize the following earlier session history so the next assistant turn can continue with less context.${customInstructions}\n\n${history}`;
}

export function buildCompactionSummary(summaryText: string): string {
  return `${COMPACTION_SUMMARY_PREFIX}\n\n${summaryText.trim()}`;
}

import type { AgentMessage } from '@earendil-works/pi-agent-core';
import type { ImageContent } from '@earendil-works/pi-ai';
import type {
  CustomEntry,
  SessionEntry,
  SessionMessageEntry,
} from '@earendil-works/pi-coding-agent';
import type { ChatMessage, ContentBlock, ImageAttachment, ImageMediaType } from '@pivi/agent/runtime';
import { mergePostTextThinkingRuns } from '@pivi/agent/runtime/chatTypes';
import { parsePiviCompactionDetails } from '@pivi/agent/session/continuationSchemas';
import {
  PIVI_MESSAGE_UI,
  PIVI_SESSION_META,
  type PiviMessageUiData,
  type PiviSessionMetaData,
} from '@pivi/agent/session/types';
import { extractUserQuery } from '@pivi/agent/session/userQuery';
import type { ToolCallInfo, ToolUseResult } from '@pivi/agent/tools';
import {
  extractDiffData,
  extractResolvedAnswers,
  extractResolvedAnswersFromResultText,
  isWriteEditTool,
  resolveLiveToolName,
  TOOL_ASK_USER_QUESTION,
} from '@pivi/agent/tools';

import {
  estimateActiveContextTokens,
  toCheckpointPresentation,
} from './piContextCompaction';
import {
  extractAgentTextContent,
  normalizeVisibleUserText,
} from './sessionMessageProjection';
import { recoverPiSubagentPresentation } from './subagentMessageRecovery';

export { applySkillDescriptions } from './skillDescriptionOverlay';

function isMessageEntry(entry: SessionEntry): entry is SessionMessageEntry {
  return entry.type === 'message';
}

function isCustomEntry(entry: SessionEntry): entry is CustomEntry {
  return entry.type === 'custom';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function normalizeToolCallInput(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function normalizeToolUseResult(value: unknown): ToolUseResult | undefined {
  return isRecord(value) ? value : undefined;
}

function contentBlocksFromAssistantContent(content: unknown): ContentBlock[] | undefined {
  if (!Array.isArray(content)) {
    return undefined;
  }

  const blocks: ContentBlock[] = [];
  for (const part of content) {
    if (!isRecord(part) || typeof part.type !== 'string') {
      continue;
    }
    if (part.type === 'text' && typeof part.text === 'string' && part.text.trim()) {
      blocks.push({ type: 'text', content: part.text });
    } else if (part.type === 'thinking' && typeof part.thinking === 'string' && part.thinking.trim()) {
      blocks.push({ type: 'thinking', content: part.thinking });
    } else if (part.type === 'toolCall' && typeof part.id === 'string') {
      blocks.push({ type: 'tool_use', toolId: part.id });
    }
  }
  return blocks.length > 0 ? blocks : undefined;
}

function toolCallsFromAssistantContent(content: unknown): ToolCallInfo[] | undefined {
  if (!Array.isArray(content)) {
    return undefined;
  }

  const toolCalls: ToolCallInfo[] = [];
  for (const part of content) {
    if (!isRecord(part) || part.type !== 'toolCall') {
      continue;
    }
    if (typeof part.id !== 'string' || typeof part.name !== 'string') {
      continue;
    }
    toolCalls.push({
      id: part.id,
      name: resolveLiveToolName(part.name),
      input: normalizeToolCallInput(part.arguments),
      status: 'running',
      isExpanded: false,
    });
  }
  return toolCalls.length > 0 ? toolCalls : undefined;
}

function applyToolResultToMessage(message: ChatMessage, agentMsg: AgentMessage): boolean {
  if (!isRecord(agentMsg) || agentMsg.role !== 'toolResult' || typeof agentMsg.toolCallId !== 'string') {
    return false;
  }
  const toolCall = message.toolCalls?.find((candidate) => candidate.id === agentMsg.toolCallId);
  if (!toolCall) {
    return false;
  }
  const result = extractAgentTextContent(agentMsg.content);
  toolCall.result = result;
  toolCall.status = agentMsg.isError === true ? 'error' : 'completed';
  applyToolResultDetails(toolCall, agentMsg.details, result);
  return true;
}

function applyToolResultDetails(
  toolCall: ToolCallInfo,
  details: unknown,
  result: string,
): void {
  const toolUseResult = normalizeToolUseResult(details);
  if (toolUseResult) {
    toolCall.toolUseResult = toolUseResult;
  }

  if (toolCall.name === TOOL_ASK_USER_QUESTION) {
    const answers = extractResolvedAnswers(toolUseResult) ?? extractResolvedAnswersFromResultText(result);
    if (answers) {
      toolCall.resolvedAnswers = answers;
    }
  }

  if (isWriteEditTool(toolCall.name)) {
    const diffData = extractDiffData(toolUseResult, toolCall);
    if (diffData) {
      toolCall.diffData = diffData;
    }
  }
}

function appendAssistantText(existing: string, next: string): string {
  if (!next) {
    return existing;
  }
  if (!existing) {
    return next;
  }
  if (existing.endsWith('\n') || next.startsWith('\n')) {
    return existing + next;
  }
  return `${existing}\n\n${next}`;
}

function appendAssistantContentBlocks(
  target: ChatMessage,
  blocks: ContentBlock[] | undefined,
  content: string,
): void {
  if (!blocks?.length) {
    return;
  }
  if (!target.contentBlocks && target.content.trim()) {
    target.contentBlocks = [{ type: 'text', content: target.content }];
  }
  target.contentBlocks = [...(target.contentBlocks ?? []), ...blocks];
  target.content = appendAssistantText(target.content, content);
}

/**
 * An interrupted turn finalizes its UI overlay before the runtime persists the
 * aborted provider segment, so the overlay lands on an earlier assistant entry
 * while already holding the whole turn. Replaying that later segment would
 * duplicate its blocks after the "Interrupted" marker.
 */
function isSegmentCoveredByOverlay(
  target: ChatMessage,
  blocks: ContentBlock[] | undefined,
  ui: PiviMessageUiData | undefined,
): boolean {
  if (ui?.contentBlocks || !blocks?.length || !target.contentBlocks?.length) return false;
  const existing = target.contentBlocks;
  return blocks.every((block) => {
    const toolId = contentBlockToolId(block);
    return toolId
      ? existing.some((candidate) => contentBlockToolId(candidate) === toolId)
      : existing.some((candidate) => sameNonToolBlock(candidate, block));
  });
}

function mergeAssistantMessageSegment(
  target: ChatMessage,
  segment: {
    entryId: string;
    content: string;
    contentBlocks: ContentBlock[] | undefined;
    toolCalls: ToolCallInfo[] | undefined;
    ui: PiviMessageUiData | undefined;
  },
  overlayCovered: boolean,
): void {
  if (overlayCovered && isSegmentCoveredByOverlay(target, segment.contentBlocks, segment.ui)) {
    applyAssistantUiOverlay(target, segment.ui, segment.entryId);
    return;
  }
  appendAssistantContentBlocks(target, segment.contentBlocks, segment.content);
  if (!segment.contentBlocks?.length && segment.content) {
    target.content = appendAssistantText(target.content, segment.content);
  }
  if (segment.toolCalls?.length) {
    target.toolCalls = [...(target.toolCalls ?? []), ...segment.toolCalls];
  }
  applyAssistantUiOverlay(target, segment.ui, segment.entryId);
}

function mergeToolCallOverlay(
  reconstructed: ToolCallInfo[] | undefined,
  overlay: ToolCallInfo[] | undefined,
): ToolCallInfo[] | undefined {
  if (!overlay) {
    return reconstructed;
  }
  if (overlay.length === 0) {
    return [];
  }

  const merged = [...(reconstructed ?? [])];
  for (const overlayToolCall of overlay) {
    const existingIndex = merged.findIndex((toolCall) => toolCall.id === overlayToolCall.id);
    const existingToolCall = existingIndex >= 0 ? merged[existingIndex] : undefined;
    if (existingToolCall) {
      merged[existingIndex] = {
        ...existingToolCall,
        ...overlayToolCall,
        input: {
          ...existingToolCall.input,
          ...overlayToolCall.input,
        },
      };
    } else {
      merged.push(overlayToolCall);
    }
  }
  return merged;
}

function contentBlockToolId(block: ContentBlock): string | undefined {
  if (block.type === 'tool_use') return block.toolId;
  if (block.type === 'subagent') return block.subagentId;
  return undefined;
}

function sameNonToolBlock(left: ContentBlock, right: ContentBlock): boolean {
  if (left.type !== right.type) return false;
  if (left.type === 'text' && right.type === 'text') return left.content === right.content;
  if (left.type === 'thinking' && right.type === 'thinking') return left.content === right.content;
  if (left.type === 'context_compacted' && right.type === 'context_compacted') {
    return left.summary === right.summary
      && left.tokensBefore === right.tokensBefore
      && left.tokensAfter === right.tokensAfter;
  }
  return false;
}

/** Keep Pi-native order when a final message-ui patch covers only the last provider segment. */
function reconcileAssistantContentBlocks(
  reconstructed: ContentBlock[] | undefined,
  overlay: ContentBlock[],
): ContentBlock[] {
  if (!reconstructed?.length) return overlay;

  const reconstructedToolIds = new Set<string>();
  for (const block of reconstructed) {
    const toolId = contentBlockToolId(block);
    if (toolId) reconstructedToolIds.add(toolId);
  }
  const overlayToolBlocks = new Map<string, ContentBlock>();
  for (const block of overlay) {
    const toolId = contentBlockToolId(block);
    if (toolId) overlayToolBlocks.set(toolId, block);
  }
  const overlayIsComplete = [...reconstructedToolIds].every(toolId => overlayToolBlocks.has(toolId));
  if (overlayIsComplete) return overlay;

  const reconciled = reconstructed.map((block) => {
    const toolId = contentBlockToolId(block);
    return toolId ? (overlayToolBlocks.get(toolId) ?? block) : block;
  });
  for (const block of overlay) {
    const toolId = contentBlockToolId(block);
    if (toolId) {
      if (!reconstructedToolIds.has(toolId)) reconciled.push(block);
      continue;
    }
    const existingIndex = reconciled.findIndex(candidate => sameNonToolBlock(candidate, block));
    if (existingIndex >= 0) {
      reconciled[existingIndex] = block;
    } else {
      reconciled.push(block);
    }
  }
  return reconciled;
}

function applyAssistantUiOverlay(
  target: ChatMessage,
  ui: PiviMessageUiData | undefined,
  fallbackAssistantMessageId: string,
): void {
  if (!ui) {
    target.assistantMessageId = fallbackAssistantMessageId;
    return;
  }
  if (ui.contentBlocks) {
    // Overlay blocks were captured from arrival-order UI projection, so a
    // reasoning leak can persist a thinking run split around the first text
    // delta; merge it back to match pi-native channel-merged content blocks.
    target.contentBlocks = reconcileAssistantContentBlocks(
      target.contentBlocks,
      mergePostTextThinkingRuns(ui.contentBlocks as ContentBlock[]),
    );
  }
  if (ui.toolCalls) {
    target.toolCalls = mergeToolCallOverlay(target.toolCalls, ui.toolCalls);
  }
  if (ui.durationSeconds !== undefined) {
    target.durationSeconds = ui.durationSeconds;
  }
  if (ui.durationFlavorWord) {
    target.durationFlavorWord = ui.durationFlavorWord;
  }
  if (ui.tokensPerSecond !== undefined) {
    target.tokensPerSecond = ui.tokensPerSecond;
  }
  if (ui.assistantMessageId) {
    target.assistantMessageId = ui.assistantMessageId;
  } else {
    target.assistantMessageId = fallbackAssistantMessageId;
  }
}

function normalizeUserMessageText(message: ChatMessage): string {
  return normalizeVisibleUserText(message.displayContent ?? message.content);
}

function isDuplicatePendingUserMessage(
  previous: ChatMessage | undefined,
  next: ChatMessage,
): boolean {
  if (!previous || previous.role !== 'user' || next.role !== 'user') {
    return false;
  }
  return normalizeUserMessageText(previous) === normalizeUserMessageText(next);
}

function tryMergeAssistantMessageSegment(
  target: ChatMessage | null,
  role: AgentMessage['role'],
  segment: {
    entryId: string;
    content: string;
    contentBlocks: ContentBlock[] | undefined;
    toolCalls: ToolCallInfo[] | undefined;
    ui: PiviMessageUiData | undefined;
  },
  overlayCovered: boolean,
): boolean {
  if (role !== 'assistant' || !target) {
    return false;
  }
  mergeAssistantMessageSegment(target, segment, overlayCovered);
  return true;
}

function extractImagesFromAgentContent(content: unknown): ImageAttachment[] | undefined {
  if (!Array.isArray(content)) {
    return undefined;
  }
  const images: ImageAttachment[] = [];
  for (const part of content) {
    if (!isImageContent(part)) continue;

    const mediaType = part.mimeType as ImageMediaType;
    if (!mediaType.startsWith('image/')) {
      continue;
    }
    const data = part.data;
    if (data.trim().length === 0) {
      continue;
    }
    images.push({
      id: `img-${images.length}`,
      name: 'attachment',
      mediaType,
      data,
      size: data.length,
      source: 'paste',
    });
  }
  return images.length > 0 ? images : undefined;
}

function isImageContent(part: unknown): part is ImageContent {
  return isRecord(part)
    && part.type === 'image'
    && typeof part.mimeType === 'string'
    && typeof part.data === 'string';
}

function messageUiFromCustom(data: unknown): PiviMessageUiData | null {
  if (!data || typeof data !== 'object') {
    return null;
  }
  const candidate = data as PiviMessageUiData;
  if (typeof candidate.targetEntryId !== 'string') {
    return null;
  }
  return candidate;
}

type CompactionSessionEntry = Extract<SessionEntry, { type: 'compaction' }>;

function compactionEntryToChatMessage(
  entry: CompactionSessionEntry,
  entriesThroughCompaction: SessionEntry[],
): ChatMessage {
  const timestamp = Date.parse(entry.timestamp) || Date.now();
  const details = parsePiviCompactionDetails(
    (entry as unknown as { details?: unknown }).details,
  );
  return {
    id: entry.id,
    role: 'assistant',
    content: '',
    timestamp,
    contentBlocks: [{
      type: 'context_compacted',
      ...(details ? { checkpoint: toCheckpointPresentation(details.piviCheckpoint) } : {}),
      summary: entry.summary,
      tokensAfter: estimateActiveContextTokens(entriesThroughCompaction),
      tokensBefore: entry.tokensBefore,
    }],
    assistantMessageId: entry.id,
  };
}

interface EntryMessageBase {
  id: string;
  content: string;
  timestamp: number;
  parentEntryId: string | null;
  ui: PiviMessageUiData | undefined;
}

// Both builders emit every field in one fixed order so user and assistant
// messages keep the same serialized shape.
function userEntryToChatMessage(base: EntryMessageBase, agentContent: unknown): ChatMessage {
  const { ui } = base;
  return {
    id: base.id,
    role: 'user',
    content: base.content,
    displayContent: extractUserQuery(ui?.displayContent ?? base.content),
    timestamp: base.timestamp,
    toolCalls: undefined,
    contentBlocks: undefined,
    images: extractImagesFromAgentContent(agentContent),
    turnRequest: ui?.turnRequest,
    durationSeconds: ui?.durationSeconds,
    durationFlavorWord: ui?.durationFlavorWord,
    tokensPerSecond: ui?.tokensPerSecond,
    parentEntryId: base.parentEntryId,
    userMessageId: ui?.userMessageId ?? base.id,
    assistantMessageId: undefined,
  };
}

function assistantEntryToChatMessage(
  base: EntryMessageBase,
  reconstructedToolCalls: ReturnType<typeof toolCallsFromAssistantContent> | undefined,
  reconstructedContentBlocks: ReturnType<typeof contentBlocksFromAssistantContent> | undefined,
): ChatMessage {
  const { ui } = base;
  return {
    id: base.id,
    role: 'assistant',
    content: base.content,
    displayContent: ui?.displayContent,
    timestamp: base.timestamp,
    toolCalls: mergeToolCallOverlay(reconstructedToolCalls, ui?.toolCalls),
    contentBlocks: (ui?.contentBlocks
      ? mergePostTextThinkingRuns(ui.contentBlocks as ContentBlock[])
      : undefined) ?? reconstructedContentBlocks,
    images: undefined,
    turnRequest: undefined,
    durationSeconds: ui?.durationSeconds,
    durationFlavorWord: ui?.durationFlavorWord,
    tokensPerSecond: ui?.tokensPerSecond,
    parentEntryId: base.parentEntryId,
    userMessageId: undefined,
    assistantMessageId: ui?.assistantMessageId ?? base.id,
  };
}

/** Map JSONL branch entries to UI chat messages (user/assistant only). */
export function entriesToChatMessages(
  branch: SessionEntry[],
  messageUiByEntryId: Map<string, PiviMessageUiData>,
): ChatMessage[] {
  const messages: ChatMessage[] = [];
  let lastAssistantMessage: ChatMessage | null = null;
  // Assistant messages whose blocks came from a turn-level UI overlay.
  const overlayMessages = new WeakSet<ChatMessage>();

  for (let entryIndex = 0; entryIndex < branch.length; entryIndex += 1) {
    const entry = branch[entryIndex];
    if (!entry) continue;
    if (entry.type === 'compaction') {
      const message = compactionEntryToChatMessage(entry, branch.slice(0, entryIndex + 1));
      messages.push(message);
      lastAssistantMessage = null;
      continue;
    }

    if (!isMessageEntry(entry)) {
      continue;
    }
    const agentMsg = entry.message;
    if (lastAssistantMessage && applyToolResultToMessage(lastAssistantMessage, agentMsg)) {
      continue;
    }
    if (agentMsg.role !== 'user' && agentMsg.role !== 'assistant') {
      continue;
    }

    const ui = messageUiByEntryId.get(entry.id);
    const content = extractAgentTextContent(agentMsg.content);
    const reconstructedContentBlocks = agentMsg.role === 'assistant'
      ? contentBlocksFromAssistantContent(agentMsg.content)
      : undefined;
    const reconstructedToolCalls = agentMsg.role === 'assistant'
      ? toolCallsFromAssistantContent(agentMsg.content)
      : undefined;

    if (
      tryMergeAssistantMessageSegment(
        lastAssistantMessage,
        agentMsg.role,
        {
          entryId: entry.id,
          content,
          contentBlocks: reconstructedContentBlocks,
          toolCalls: reconstructedToolCalls,
          ui,
        },
        !!lastAssistantMessage && overlayMessages.has(lastAssistantMessage),
      )
    ) {
      continue;
    }

    const timestamp = typeof agentMsg.timestamp === 'number'
      ? agentMsg.timestamp
      : Date.parse(entry.timestamp) || Date.now();
    const base = { id: entry.id, content, timestamp, parentEntryId: entry.parentId ?? null, ui };
    const message = agentMsg.role === 'user'
      ? userEntryToChatMessage(base, agentMsg.content)
      : assistantEntryToChatMessage(base, reconstructedToolCalls, reconstructedContentBlocks);

    const previousMessage = messages.at(-1);
    if (isDuplicatePendingUserMessage(previousMessage, message)) {
      messages[messages.length - 1] = message;
      lastAssistantMessage = null;
      continue;
    }

    if (agentMsg.role === 'assistant' && ui?.contentBlocks) overlayMessages.add(message);
    messages.push(message);
    lastAssistantMessage = agentMsg.role === 'assistant' ? message : null;
  }

  recoverPiSubagentPresentation(messages);
  return messages;
}

export function collectMessageUiMap(branch: SessionEntry[]): Map<string, PiviMessageUiData> {
  const map = new Map<string, PiviMessageUiData>();
  for (const entry of branch) {
    if (!isCustomEntry(entry) || entry.customType !== PIVI_MESSAGE_UI) {
      continue;
    }
    const ui = messageUiFromCustom(entry.data);
    if (ui) {
      map.set(ui.targetEntryId, {
        ...map.get(ui.targetEntryId),
        ...ui,
      });
    }
  }
  return map;
}

export function readSessionMetaFromBranch(branch: SessionEntry[]): PiviSessionMetaData | null {
  for (let i = branch.length - 1; i >= 0; i--) {
    const entry = branch[i];
    if (!entry || !isCustomEntry(entry) || entry.customType !== PIVI_SESSION_META) {
      continue;
    }
    const data = entry.data as PiviSessionMetaData | undefined;
    if (data && typeof data.title === 'string') {
      return data;
    }
  }
  return null;
}

export function firstUserMessagePreview(branch: SessionEntry[]): string {
  for (const entry of branch) {
    if (!isMessageEntry(entry) || entry.message.role !== 'user') {
      continue;
    }
    const text = extractAgentTextContent(entry.message.content);
    const visibleText = extractUserQuery(text).trim();
    if (visibleText) {
      return visibleText.length > 50 ? `${visibleText.slice(0, 50)}…` : visibleText;
    }
  }
  return 'New session';
}

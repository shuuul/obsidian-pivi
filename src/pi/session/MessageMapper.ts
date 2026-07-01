import type { AgentMessage } from '@earendil-works/pi-agent-core';
import type { ImageContent, TextContent } from '@earendil-works/pi-ai';
import type {
  CustomEntry,
  SessionEntry,
  SessionMessageEntry,
} from '@earendil-works/pi-coding-agent/dist/core/session-manager.js';

import { extractDiffData } from '../../pi/tools/diff';
import { extractResolvedAnswers, extractResolvedAnswersFromResultText } from '../../pi/tools/toolInput';
import { isWriteEditTool, TOOL_ASK_USER_QUESTION } from '../../pi/tools/toolNames';
import type { ChatMessage, ContentBlock, ImageAttachment, ImageMediaType } from '../../pi/types/chat';
import type { ToolUseResult } from '../../pi/types/diff';
import type { ToolCallInfo } from '../../pi/types/tools';
import { extractUserQuery } from '../../utils/context';
import {
  PIVI_MESSAGE_UI,
  PIVI_SESSION_META,
  type PiviMessageUiData,
  type PiviSessionMetaData,
} from './types';

function isMessageEntry(entry: SessionEntry): entry is SessionMessageEntry {
  return entry.type === 'message';
}

function isCustomEntry(entry: SessionEntry): entry is CustomEntry {
  return entry.type === 'custom';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function extractTextFromAgentContent(content: unknown): string {
  if (typeof content === 'string') {
    return content;
  }
  if (!Array.isArray(content)) {
    return '';
  }
  return content
    .filter((part): part is TextContent => part.type === 'text')
    .map((part) => part.text)
    .join('');
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
      name: part.name,
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
  const result = extractTextFromAgentContent(agentMsg.content);
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

function mergeAssistantMessageSegment(
  target: ChatMessage,
  segment: {
    entryId: string;
    content: string;
    contentBlocks: ContentBlock[] | undefined;
    toolCalls: ToolCallInfo[] | undefined;
    ui: PiviMessageUiData | undefined;
  },
): void {
  appendAssistantContentBlocks(target, segment.contentBlocks, segment.content);
  if (!segment.contentBlocks?.length && segment.content) {
    target.content = appendAssistantText(target.content, segment.content);
  }
  if (segment.toolCalls?.length) {
    target.toolCalls = [...(target.toolCalls ?? []), ...segment.toolCalls];
  }
  if (segment.ui?.durationSeconds !== undefined) {
    target.durationSeconds = segment.ui.durationSeconds;
  }
  if (segment.ui?.durationFlavorWord) {
    target.durationFlavorWord = segment.ui.durationFlavorWord;
  }
  if (segment.ui?.assistantMessageId) {
    target.assistantMessageId = segment.ui.assistantMessageId;
  } else {
    target.assistantMessageId = segment.entryId;
  }
}

function normalizeUserMessageText(message: ChatMessage): string {
  return (message.displayContent ?? message.content)
    .replace(/\s+/g, ' ')
    .trim();
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
): boolean {
  if (role !== 'assistant' || !target) {
    return false;
  }
  mergeAssistantMessageSegment(target, segment);
  return true;
}

function extractImagesFromAgentContent(content: unknown): ImageAttachment[] | undefined {
  if (!Array.isArray(content)) {
    return undefined;
  }
  const images: ImageAttachment[] = [];
  for (const part of content) {
    if (part.type !== 'image') {
      continue;
    }
    const imagePart = part as ImageContent;
    const mediaType = imagePart.mimeType as ImageMediaType;
    if (!mediaType.startsWith('image/')) {
      continue;
    }
    const data = imagePart.data ?? '';
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

/** Map JSONL branch entries to UI chat messages (user/assistant only). */
export function entriesToChatMessages(
  branch: SessionEntry[],
  messageUiByEntryId: Map<string, PiviMessageUiData>,
): ChatMessage[] {
  const messages: ChatMessage[] = [];
  let lastAssistantMessage: ChatMessage | null = null;

  for (const entry of branch) {
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
    const content = extractTextFromAgentContent(agentMsg.content);
    const timestamp = typeof agentMsg.timestamp === 'number'
      ? agentMsg.timestamp
      : Date.parse(entry.timestamp) || Date.now();
    const displayContent = ui?.displayContent
      ?? (agentMsg.role === 'user' ? extractUserQuery(content) : undefined);

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
          contentBlocks: (ui?.contentBlocks as ContentBlock[] | undefined) ?? reconstructedContentBlocks,
          toolCalls: reconstructedToolCalls,
          ui,
        },
      )
    ) {
      continue;
    }

    const message: ChatMessage = {
      id: entry.id,
      role: agentMsg.role,
      content,
      displayContent,
      timestamp,
      toolCalls: reconstructedToolCalls,
      contentBlocks: (ui?.contentBlocks as ContentBlock[] | undefined) ?? reconstructedContentBlocks,
      images: agentMsg.role === 'user'
        ? extractImagesFromAgentContent(agentMsg.content)
        : undefined,
      durationSeconds: ui?.durationSeconds,
      durationFlavorWord: ui?.durationFlavorWord,
      parentEntryId: entry.parentId ?? null,
      userMessageId: agentMsg.role === 'user' ? (ui?.userMessageId ?? entry.id) : undefined,
      assistantMessageId: agentMsg.role === 'assistant' ? (ui?.assistantMessageId ?? entry.id) : undefined,
    };

    if (isDuplicatePendingUserMessage(messages[messages.length - 1], message)) {
      messages[messages.length - 1] = message;
      lastAssistantMessage = null;
      continue;
    }

    messages.push(message);
    lastAssistantMessage = agentMsg.role === 'assistant' ? message : null;
  }

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
      map.set(ui.targetEntryId, ui);
    }
  }
  return map;
}

export function readSessionMetaFromBranch(branch: SessionEntry[]): PiviSessionMetaData | null {
  for (let i = branch.length - 1; i >= 0; i--) {
    const entry = branch[i];
    if (!isCustomEntry(entry) || entry.customType !== PIVI_SESSION_META) {
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
    const text = extractTextFromAgentContent(entry.message.content);
    const visibleText = extractUserQuery(text).trim();
    if (visibleText) {
      return visibleText.length > 50 ? `${visibleText.slice(0, 50)}…` : visibleText;
    }
  }
  return 'New session';
}

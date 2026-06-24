import type { AgentMessage } from '@earendil-works/pi-agent-core';
import type { ImageContent, TextContent } from '@earendil-works/pi-ai';
import type {
  CustomEntry,
  SessionEntry,
  SessionMessageEntry,
} from '@earendil-works/pi-coding-agent/dist/core/session-manager.js';

import type { ChatMessage, ContentBlock, ImageAttachment, ImageMediaType } from '../../core/types/chat';
import type { ToolCallInfo } from '../../core/types/tools';
import { extractUserQuery } from '../../utils/context';
import {
  OBSIUS_MESSAGE_UI,
  OBSIUS_SESSION_META,
  type ObsiusMessageUiData,
  type ObsiusSessionMetaData,
} from './obsiusCustomTypes';

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
  toolCall.result = extractTextFromAgentContent(agentMsg.content);
  toolCall.status = agentMsg.isError === true ? 'error' : 'completed';
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

function messageUiFromCustom(data: unknown): ObsiusMessageUiData | null {
  if (!data || typeof data !== 'object') {
    return null;
  }
  const candidate = data as ObsiusMessageUiData;
  if (typeof candidate.targetEntryId !== 'string') {
    return null;
  }
  return candidate;
}

/** Map JSONL branch entries to UI chat messages (user/assistant only). */
export function entriesToChatMessages(
  branch: SessionEntry[],
  messageUiByEntryId: Map<string, ObsiusMessageUiData>,
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
      userMessageId: ui?.userMessageId,
      assistantMessageId: ui?.assistantMessageId,
    };
    messages.push(message);
    lastAssistantMessage = agentMsg.role === 'assistant' ? message : null;
  }

  return messages;
}

export function collectMessageUiMap(branch: SessionEntry[]): Map<string, ObsiusMessageUiData> {
  const map = new Map<string, ObsiusMessageUiData>();
  for (const entry of branch) {
    if (!isCustomEntry(entry) || entry.customType !== OBSIUS_MESSAGE_UI) {
      continue;
    }
    const ui = messageUiFromCustom(entry.data);
    if (ui) {
      map.set(ui.targetEntryId, ui);
    }
  }
  return map;
}

export function readSessionMetaFromBranch(branch: SessionEntry[]): ObsiusSessionMetaData | null {
  for (let i = branch.length - 1; i >= 0; i--) {
    const entry = branch[i];
    if (!isCustomEntry(entry) || entry.customType !== OBSIUS_SESSION_META) {
      continue;
    }
    const data = entry.data as ObsiusSessionMetaData | undefined;
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
    if (text.trim()) {
      return text.length > 50 ? `${text.slice(0, 50)}…` : text;
    }
  }
  return 'New session';
}

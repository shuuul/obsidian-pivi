import type { ImageContent, TextContent } from '@earendil-works/pi-ai';
import type {
  CustomEntry,
  SessionEntry,
  SessionMessageEntry,
} from '@earendil-works/pi-coding-agent/dist/core/session-manager.js';

import type { ChatMessage, ContentBlock, ImageAttachment, ImageMediaType } from '../../core/types/chat';
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

  for (const entry of branch) {
    if (!isMessageEntry(entry)) {
      continue;
    }
    const agentMsg = entry.message;
    if (agentMsg.role !== 'user' && agentMsg.role !== 'assistant') {
      continue;
    }

    const ui = messageUiByEntryId.get(entry.id);
    const content = extractTextFromAgentContent(agentMsg.content);
    const timestamp = typeof agentMsg.timestamp === 'number'
      ? agentMsg.timestamp
      : Date.parse(entry.timestamp) || Date.now();

    messages.push({
      id: entry.id,
      role: agentMsg.role,
      content,
      displayContent: ui?.displayContent,
      timestamp,
      contentBlocks: ui?.contentBlocks as ContentBlock[] | undefined,
      images: agentMsg.role === 'user'
        ? extractImagesFromAgentContent(agentMsg.content)
        : undefined,
      durationSeconds: ui?.durationSeconds,
      durationFlavorWord: ui?.durationFlavorWord,
      userMessageId: ui?.userMessageId,
      assistantMessageId: ui?.assistantMessageId,
    });
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
  return 'New conversation';
}

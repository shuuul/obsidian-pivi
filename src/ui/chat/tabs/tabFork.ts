import type { ChatMessage } from '@pivi/agent/runtime';
import type { ChatPorts } from '@pivi/agent/runtime/chatPorts';
import { Notice } from 'obsidian';

import { t } from '@/app/i18n';

import { getAssistantEntryId, getUserEntryId } from '../branchContext';
import type { TabData } from './types';

export interface ForkContext {
  messages: ChatMessage[];
  sourceSessionId: string;
  /** JSONL entry id to fork from (user message). */
  forkAtEntryId: string;
  sourceTitle?: string;
  /** 1-based index used for fork title suffix (counts only non-interrupt user messages). */
  forkAtUserMessage?: number;
  currentNote?: string;
}

function deepCloneMessages(messages: ChatMessage[]): ChatMessage[] {
  if (typeof structuredClone === 'function') {
    return structuredClone(messages);
  }
  return JSON.parse(JSON.stringify(messages)) as ChatMessage[];
}

function countUserMessagesForForkTitle(messages: ChatMessage[]): number {
  return messages.filter(m => m.role === 'user' && !m.isInterrupt && !m.isRebuiltContext).length;
}

function getForkEntryId(message: ChatMessage): string | undefined {
  return message.role === 'user' ? getUserEntryId(message) : getAssistantEntryId(message);
}

function getMessagesBeforeForkTarget(messages: ChatMessage[], index: number): ChatMessage[] {
  return deepCloneMessages(messages.slice(0, index + 1));
}

interface ForkSource {
  sourceSessionId: string;
  sourceTitle?: string;
  currentNote?: string;
}

function resolveForkSource(
  tab: TabData,
  sessions: ChatPorts['sessions'],
): ForkSource | null {
  const openSession = tab.openSessionId
    ? sessions.findOpenSession(tab.openSessionId)
    : null;

  const sourceSessionId = tab.service
    ? tab.service.getSessionId() ?? openSession?.sessionId ?? null
    : (openSession?.sessionId ?? null);

  if (!sourceSessionId) {
    new Notice(t('chat.fork.failed', { error: t('chat.fork.errorNoSession') }));
    return null;
  }

  return {
    sourceSessionId,
    sourceTitle: openSession?.title,
    currentNote: openSession?.currentNote,
  };
}

export async function handleForkRequest(
  tab: TabData,
  sessions: ChatPorts['sessions'],
  messageId: string,
  forkRequestCallback: (forkContext: ForkContext) => Promise<void>,
): Promise<void> {
  const { state } = tab;

  if (state.isStreaming) {
    new Notice(t('chat.fork.unavailableStreaming'));
    return;
  }

  const msgs = state.messages;
  const messageIdx = msgs.findIndex(m => m.id === messageId);
  if (messageIdx === -1) {
    new Notice(t('chat.fork.failed', { error: t('chat.fork.errorMessageNotFound') }));
    return;
  }

  const message = msgs[messageIdx];
  const forkEntryId = message ? getForkEntryId(message) : undefined;
  if (!forkEntryId) {
    new Notice(t('chat.fork.unavailableNoUuid'));
    return;
  }

  const source = resolveForkSource(tab, sessions);
  if (!source) return;

  await forkRequestCallback({
    messages: getMessagesBeforeForkTarget(msgs, messageIdx),
    sourceSessionId: source.sourceSessionId,
    forkAtEntryId: forkEntryId,
    sourceTitle: source.sourceTitle,
    forkAtUserMessage: (state.olderUserMessageCount ?? 0)
      + countUserMessagesForForkTitle(msgs.slice(0, messageIdx + 1)),
    currentNote: source.currentNote,
  });
}

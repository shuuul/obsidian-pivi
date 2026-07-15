import type { ChatMessage } from '@pivi/pivi-agent-core/foundation';
import type { ChatPorts } from '@pivi/pivi-agent-core/runtime/chatPorts';
import { Notice } from 'obsidian';

import { t } from '@/app/i18n';

import { getAssistantEntryId, getUserEntryId } from '../branchContext';
import type { TabData } from './types';

export interface ForkContext {
  messages: ChatMessage[];
  sourceSessionId: string;
  /** JSONL entry id to fork from (user message). */
  forkAtEntryId: string;
  resumeAt: string;
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

function getResumeEntryId(messages: ChatMessage[], index: number, forkEntryId: string): string {
  const message = messages[index];
  if (!message || message.role === 'assistant') {
    return forkEntryId;
  }

  for (let i = index - 1; i >= 0; i--) {
    const message = messages[i];
    if (!message) continue;
    const assistantEntryId = getAssistantEntryId(message);
    if (assistantEntryId) {
      return assistantEntryId;
    }
  }
  return forkEntryId;
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
    resumeAt: getResumeEntryId(msgs, messageIdx, forkEntryId),
    sourceTitle: source.sourceTitle,
    forkAtUserMessage: (state.olderUserMessageCount ?? 0)
      + countUserMessagesForForkTitle(msgs.slice(0, messageIdx + 1)),
    currentNote: source.currentNote,
  });
}

export async function handleForkAll(
  tab: TabData,
  sessions: ChatPorts['sessions'],
  forkRequestCallback: (forkContext: ForkContext) => Promise<void>,
): Promise<void> {
  const { state } = tab;

  if (state.isStreaming) {
    new Notice(t('chat.fork.unavailableStreaming'));
    return;
  }

  const msgs = state.messages;
  if (msgs.length === 0) {
    new Notice(t('chat.fork.commandNoMessages'));
    return;
  }

  let lastAssistantUuid: string | undefined;
  for (let i = msgs.length - 1; i >= 0; i--) {
    const message = msgs[i];
    if (message?.role === 'assistant' && message.assistantMessageId) {
      lastAssistantUuid = message.assistantMessageId;
      break;
    }
  }

  if (!lastAssistantUuid) {
    new Notice(t('chat.fork.commandNoAssistantUuid'));
    return;
  }

  const source = resolveForkSource(tab, sessions);
  if (!source) return;

  const lastUser = [...msgs].reverse().find((m) => m.role === 'user' && !m.isInterrupt);
  const lastUserEntryId = lastUser ? getUserEntryId(lastUser) : undefined;
  if (!lastUser || !lastUserEntryId) {
    new Notice(t('chat.fork.failed', { error: t('chat.fork.errorMessageNotFound') }));
    return;
  }

  await forkRequestCallback({
    messages: deepCloneMessages(msgs),
    sourceSessionId: source.sourceSessionId,
    forkAtEntryId: lastUserEntryId,
    resumeAt: lastAssistantUuid,
    sourceTitle: source.sourceTitle,
    forkAtUserMessage: (state.olderUserMessageCount ?? 0)
      + countUserMessagesForForkTitle(msgs)
      + 1,
    currentNote: source.currentNote,
  });
}

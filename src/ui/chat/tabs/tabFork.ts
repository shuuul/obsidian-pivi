import type { ChatMessage } from '@pivi/pivi-agent-core/foundation';
import { Notice } from 'obsidian';

import type PiviPlugin from '@/app/PiviPluginHost';
import { t } from '@/i18n';

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
  if (messages[index].role === 'assistant') {
    return forkEntryId;
  }

  for (let i = index - 1; i >= 0; i--) {
    const assistantEntryId = getAssistantEntryId(messages[i]);
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

function resolveForkSource(tab: TabData, plugin: PiviPlugin): ForkSource | null {
  const openSession = tab.openSessionId
    ? plugin.getOpenSessionSync(tab.openSessionId)
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
  plugin: PiviPlugin,
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

  const forkEntryId = getForkEntryId(msgs[messageIdx]);
  if (!forkEntryId) {
    new Notice(t('chat.fork.unavailableNoUuid'));
    return;
  }

  const source = resolveForkSource(tab, plugin);
  if (!source) return;

  await forkRequestCallback({
    messages: getMessagesBeforeForkTarget(msgs, messageIdx),
    sourceSessionId: source.sourceSessionId,
    forkAtEntryId: forkEntryId,
    resumeAt: getResumeEntryId(msgs, messageIdx, forkEntryId),
    sourceTitle: source.sourceTitle,
    forkAtUserMessage: countUserMessagesForForkTitle(msgs.slice(0, messageIdx + 1)),
    currentNote: source.currentNote,
  });
}

export async function handleForkAll(
  tab: TabData,
  plugin: PiviPlugin,
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
    if (msgs[i].role === 'assistant' && msgs[i].assistantMessageId) {
      lastAssistantUuid = msgs[i].assistantMessageId;
      break;
    }
  }

  if (!lastAssistantUuid) {
    new Notice(t('chat.fork.commandNoAssistantUuid'));
    return;
  }

  const source = resolveForkSource(tab, plugin);
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
    forkAtUserMessage: countUserMessagesForForkTitle(msgs) + 1,
    currentNote: source.currentNote,
  });
}

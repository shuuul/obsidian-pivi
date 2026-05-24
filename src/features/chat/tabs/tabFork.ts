import { Notice } from 'obsidian';

import { PiAgentServices } from '../../../core/agent/PiAgentServices';
import type { ChatMessage } from '../../../core/types';
import { t } from '../../../i18n/i18n';
import type ObsiusPlugin from '../../../main';
import { findRewindContext } from '../rewind';
import { getTabCapabilities } from './tabAgentContext';
import type { TabData } from './types';

export interface ForkContext {
  messages: ChatMessage[];
  sourceSessionId: string;
  sourceAgentState?: Record<string, unknown>;
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

interface ForkSource {
  sourceSessionId: string;
  sourceAgentState?: Record<string, unknown>;
  sourceTitle?: string;
  currentNote?: string;
}

function resolveForkSource(tab: TabData, plugin: ObsiusPlugin): ForkSource | null {
  const conversation = tab.conversationId
    ? plugin.getConversationSync(tab.conversationId)
    : null;

  const sourceSessionId = tab.service
    ? tab.service.resolveSessionIdForFork(conversation ?? null)
    : PiAgentServices
      .getConversationHistoryService()
      .resolveSessionIdForConversation(conversation);

  if (!sourceSessionId) {
    new Notice(t('chat.fork.failed', { error: t('chat.fork.errorNoSession') }));
    return null;
  }

  return {
    sourceSessionId,
    sourceAgentState: conversation?.agentState,
    sourceTitle: conversation?.title,
    currentNote: conversation?.currentNote,
  };
}

export async function handleForkRequest(
  tab: TabData,
  plugin: ObsiusPlugin,
  userMessageId: string,
  forkRequestCallback: (forkContext: ForkContext) => Promise<void>,
): Promise<void> {
  const { state } = tab;

  if (!getTabCapabilities(tab).supportsFork) {
    new Notice('Fork is not available in the current runtime.');
    return;
  }

  if (state.isStreaming) {
    new Notice(t('chat.fork.unavailableStreaming'));
    return;
  }

  const msgs = state.messages;
  const userIdx = msgs.findIndex(m => m.id === userMessageId);
  if (userIdx === -1) {
    new Notice(t('chat.fork.failed', { error: t('chat.fork.errorMessageNotFound') }));
    return;
  }

  if (!msgs[userIdx].userMessageId) {
    new Notice(t('chat.fork.unavailableNoUuid'));
    return;
  }

  const rewindCtx = findRewindContext(msgs, userIdx);
  if (!rewindCtx.hasResponse || !rewindCtx.prevAssistantUuid) {
    new Notice(t('chat.fork.unavailableNoResponse'));
    return;
  }

  const source = resolveForkSource(tab, plugin);
  if (!source) return;

  await forkRequestCallback({
    messages: deepCloneMessages(msgs.slice(0, userIdx)),
    sourceSessionId: source.sourceSessionId,
    sourceAgentState: source.sourceAgentState,
    resumeAt: rewindCtx.prevAssistantUuid,
    sourceTitle: source.sourceTitle,
    forkAtUserMessage: countUserMessagesForForkTitle(msgs.slice(0, userIdx + 1)),
    currentNote: source.currentNote,
  });
}

export async function handleForkAll(
  tab: TabData,
  plugin: ObsiusPlugin,
  forkRequestCallback: (forkContext: ForkContext) => Promise<void>,
): Promise<void> {
  const { state } = tab;

  if (!getTabCapabilities(tab).supportsFork) {
    new Notice('Fork is not available in the current runtime.');
    return;
  }

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

  await forkRequestCallback({
    messages: deepCloneMessages(msgs),
    sourceSessionId: source.sourceSessionId,
    sourceAgentState: source.sourceAgentState,
    resumeAt: lastAssistantUuid,
    sourceTitle: source.sourceTitle,
    forkAtUserMessage: countUserMessagesForForkTitle(msgs) + 1,
    currentNote: source.currentNote,
  });
}

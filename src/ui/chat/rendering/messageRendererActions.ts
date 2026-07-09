import { resolveUserMessageDisplayText } from '@pivi/pivi-agent-core/context/context';
import type { ChatMessage } from '@pivi/pivi-agent-core/foundation';
import { Notice, setIcon } from 'obsidian';

import { t } from '@/i18n';

import { normalizeObsidianAppLinksInMarkdown } from '../../shared/utils/fileLink';
import { findRedoContext } from '../branchContext';

export function runRendererAction(action: () => Promise<void>): void {
  void action().catch(() => {
    // UI actions already surface expected failures locally.
  });
}

export interface MessageRendererActionsHost {
  messagesEl: HTMLElement;
  forkCallback?: (messageId: string) => Promise<void>;
  redoCallback?: (messageId: string) => Promise<void>;
}

export function getMessageCopyContent(msg: ChatMessage): string {
  if (msg.role === 'user') {
    return resolveUserMessageDisplayText(msg);
  }

  const textBlocks = msg.contentBlocks
    ?.filter((block): block is { type: 'text'; content: string } => block.type === 'text')
    .map((block) => block.content.trim())
    .filter((content) => content.length > 0);
  if (textBlocks && textBlocks.length > 0) {
    return textBlocks.join('\n\n');
  }
  return msg.content.trim();
}

export function getForkEntryId(msg: ChatMessage): string | undefined {
  return msg.role === 'user' ? msg.userMessageId : msg.assistantMessageId;
}

export function hasPendingAsyncSubagent(msg: ChatMessage): boolean {
  if (msg.role !== 'assistant' || !msg.toolCalls?.length) {
    return false;
  }
  return msg.toolCalls.some((toolCall) => {
    const subagent = toolCall.subagent;
    if (subagent?.mode !== 'async') {
      return false;
    }
    const status = subagent.asyncStatus ?? subagent.status;
    return status === 'pending' || status === 'running';
  });
}

export function getOrCreateActionsToolbar(
  msgEl: HTMLElement,
  role: ChatMessage['role'],
): HTMLElement {
  const existing = msgEl.querySelector<HTMLElement>('.pivi-message-actions, .pivi-user-msg-actions');
  if (existing) return existing;
  return msgEl.createDiv({
    cls: [
      'pivi-message-actions',
      role === 'user' ? 'pivi-user-msg-actions' : 'pivi-assistant-msg-actions',
    ],
  });
}

export function createActionButton(
  toolbar: HTMLElement,
  cls: string | string[],
  icon: string,
  ariaLabel: string,
): HTMLButtonElement {
  const btn = toolbar.createEl('button', {
    cls: ['pivi-message-action-btn', ...(Array.isArray(cls) ? cls : [cls])],
    attr: { type: 'button' },
  });
  setIcon(btn, icon);
  btn.setAttribute('aria-label', ariaLabel);
  return btn;
}

export function addMessageCopyButton(
  toolbar: HTMLElement,
  content: string,
  role: ChatMessage['role'],
): void {
  const copyBtn = createActionButton(
    toolbar,
    role === 'user'
      ? ['pivi-message-copy-btn', 'pivi-user-msg-copy-btn']
      : ['pivi-message-copy-btn', 'pivi-assistant-msg-copy-btn'],
    'copy',
    role === 'assistant'
      ? t('chat.messageActions.copyAgentResponseAriaLabel')
      : t('chat.messageActions.copyAriaLabel'),
  );
  const copyContent = normalizeObsidianAppLinksInMarkdown(content);

  let feedbackTimeout: number | null = null;

  copyBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    runRendererAction(async () => {
      try {
        await navigator.clipboard.writeText(copyContent);
      } catch {
        return;
      }
      if (feedbackTimeout) window.clearTimeout(feedbackTimeout);
      copyBtn.empty();
      setIcon(copyBtn, 'check');
      copyBtn.classList.add('copied');
      feedbackTimeout = window.setTimeout(() => {
        copyBtn.empty();
        setIcon(copyBtn, 'copy');
        copyBtn.classList.remove('copied');
        feedbackTimeout = null;
      }, 1500);
    });
  });
}

export function findMostRecentUserElement(messagesEl: HTMLElement): HTMLElement | null {
  const userMessages = messagesEl.querySelectorAll<HTMLElement>('.pivi-message[data-role="user"]');
  return userMessages.length > 0 ? userMessages[userMessages.length - 1] : null;
}

export function jumpToMessage(messagesEl: HTMLElement, target: HTMLElement): void {
  const messagesRect = messagesEl.getBoundingClientRect();
  const targetRect = target.getBoundingClientRect();
  const targetTop = messagesEl.scrollTop
    + targetRect.top
    - messagesRect.top
    - ((messagesEl.clientHeight - targetRect.height) / 2);
  messagesEl.scrollTo({ top: Math.max(0, targetTop), behavior: 'smooth' });
  target.setAttribute('tabindex', '-1');
  target.focus({ preventScroll: true });
  target.classList.add('pivi-message-jump-target');

  window.setTimeout(() => {
    target.classList.remove('pivi-message-jump-target');
  }, 1200);
}

export function addScrollToRecentUserButton(host: MessageRendererActionsHost, toolbar: HTMLElement): void {
  const btn = createActionButton(
    toolbar,
    'pivi-message-scroll-user-btn',
    'user',
    t('chat.messageActions.scrollToRecentUserAriaLabel'),
  );
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const target = findMostRecentUserElement(host.messagesEl);
    if (!target) return;
    jumpToMessage(host.messagesEl, target);
  });
}

export function addForkButton(
  host: MessageRendererActionsHost,
  toolbar: HTMLElement,
  messageId: string,
): void {
  const btn = createActionButton(toolbar, 'pivi-message-fork-btn', 'git-fork', t('chat.fork.ariaLabel'));
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    runRendererAction(async () => {
      try {
        await host.forkCallback?.(messageId);
      } catch (err) {
        new Notice(t('chat.fork.failed', { error: err instanceof Error ? err.message : 'Unknown error' }));
      }
    });
  });
}

export function addRedoButton(
  host: MessageRendererActionsHost,
  toolbar: HTMLElement,
  messageId: string,
): void {
  const btn = createActionButton(toolbar, 'pivi-message-redo-btn', 'refresh-cw', t('chat.redo.ariaLabel'));
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    runRendererAction(async () => {
      try {
        await host.redoCallback?.(messageId);
      } catch (err) {
        new Notice(t('chat.redo.failed', { error: err instanceof Error ? err.message : 'Unknown error' }));
      }
    });
  });
}

function canRedoAssistantMessage(
  msg: ChatMessage,
  allMessages: ChatMessage[] | undefined,
  index: number | undefined,
): boolean {
  if (msg.role !== 'assistant' || !allMessages || index === undefined) {
    return false;
  }
  return findRedoContext(allMessages, index) !== null;
}

export function refreshMessageActions(
  host: MessageRendererActionsHost,
  msgEl: HTMLElement,
  msg: ChatMessage,
  allMessages?: ChatMessage[],
  index?: number,
): void {
  const toolbar = getOrCreateActionsToolbar(msgEl, msg.role);
  toolbar.empty();
  const hasPendingSubagent = hasPendingAsyncSubagent(msg);

  const copyContent = getMessageCopyContent(msg);
  if (copyContent) {
    addMessageCopyButton(toolbar, copyContent, msg.role);
  }

  if (msg.role === 'assistant') {
    addScrollToRecentUserButton(host, toolbar);
    if (!hasPendingSubagent && host.redoCallback && canRedoAssistantMessage(msg, allMessages, index)) {
      addRedoButton(host, toolbar, msg.id);
    }
    if (!hasPendingSubagent && host.forkCallback && getForkEntryId(msg)) {
      addForkButton(host, toolbar, msg.id);
    }
  }

  if (toolbar.children.length === 0) {
    toolbar.remove();
  }
}

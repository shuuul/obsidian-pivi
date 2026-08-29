import { PluginLogger } from '@pivi/agent/logging/pluginLogger';
import type { ChatMessage } from '@pivi/agent/runtime';
import type { ChatPorts } from '@pivi/agent/runtime/chatPorts';
import type { ToolCallInfo } from '@pivi/agent/tools';
import type {
  MessageContentAdapter,
  MessageContentAdapterContext,
  MessageViewportHandle,
} from '@pivi/pivi-react';
import type { MessagePresentationRuntime } from '@pivi/pivi-react/mount';

import { createStreamingMarkdownContentAdapter } from '@/app/ui/createStreamingMarkdownContentAdapter';
import { createSubagentContentAdapter } from '@/app/ui/createSubagentContentAdapter';
import { findRedoContext } from '@/ui/chat/branchContext';
import {
  formatConversationAsMarkdown,
  getForkEntryId,
  getMessageCopyContent,
  hasPendingAsyncSubagent,
} from '@/ui/chat/rendering/messageRendererActions';
import { renderToolContent } from '@/ui/chat/rendering/ToolCallRenderer';
import type { TabData } from '@/ui/chat/tabs/types';

const logger = new PluginLogger('ImperativeChatMessagePresentation');

interface MountedReplacingContent {
  readonly identity: string;
  disposed: boolean;
  revision: number;
}

function renderReplacingContent<Value>(
  container: HTMLElement,
  state: MountedReplacingContent,
  value: Value,
  context: MessageContentAdapterContext,
  render: (
    target: HTMLElement,
    value: Value,
    context: MessageContentAdapterContext,
  ) => Promise<void> | void,
): void {
  if (context.generation !== state.identity) {
    throw new Error(
      `Imperative content identity changed from ${state.identity} to ${context.generation}`,
    );
  }
  const revision = ++state.revision;
  const staging = container.ownerDocument.win.createDiv();
  void Promise.resolve(render(staging, value, context))
    .then(() => {
      if (state.disposed || revision !== state.revision) {
        staging.replaceChildren();
        return;
      }
      container.replaceChildren(...Array.from(staging.childNodes));
    })
    .catch((error) => {
      staging.replaceChildren();
      logger.warn('Failed to render imperative message content', error);
    });
}

export function createReplacingContentAdapter<Value>(
  render: (
    target: HTMLElement,
    value: Value,
    context: MessageContentAdapterContext,
  ) => Promise<void> | void,
): MessageContentAdapter<Value> {
  const mounted = new WeakMap<HTMLElement, MountedReplacingContent>();
  return {
    mount(container, value, context) {
      if (container.childNodes.length !== 0) {
        throw new Error('Imperative content adapters require an empty React-owned slot');
      }
      const state: MountedReplacingContent = {
        identity: context.generation,
        disposed: false,
        revision: 0,
      };
      mounted.set(container, state);
      renderReplacingContent(container, state, value, context, render);
      return () => {
        state.disposed = true;
        state.revision += 1;
        mounted.delete(container);
        container.replaceChildren();
      };
    },
    update(container, value, context) {
      const state = mounted.get(container);
      if (!state) {
        throw new Error(`Imperative content ${context.generation} is not mounted`);
      }
      renderReplacingContent(container, state, value, context, render);
    },
  };
}

async function copyMessage(tab: TabData, message: ChatMessage): Promise<void> {
  const content = getMessageCopyContent(message);
  const clipboard = tab.dom.messagesEl.ownerDocument.defaultView?.navigator.clipboard;
  if (clipboard?.writeText) await clipboard.writeText(content);
}

const MARKDOWN_COPY_PAGE_SIZE = 100;

async function copyConversationAsMarkdown(
  tab: TabData,
  sessions: ChatPorts['sessions'],
  throughMessageId: string,
): Promise<void> {
  let messages = [...tab.state.messages];
  let hasOlder = tab.state.hasOlderMessages;
  const openSessionId = tab.openSessionId ?? tab.state.currentOpenSessionId;
  let beforeEntryId = messages[0]?.id;

  while (hasOlder && openSessionId && beforeEntryId) {
    const page = await sessions.readOlder(
      openSessionId,
      beforeEntryId,
      MARKDOWN_COPY_PAGE_SIZE,
    );
    if (!page || page.messages.length === 0) break;
    const existingIds = new Set(messages.map(message => message.id));
    const older = page.messages.filter(message => !existingIds.has(message.id));
    if (older.length === 0) break;
    messages = [...older, ...messages];
    beforeEntryId = older[0]?.id;
    hasOlder = page.hasOlder;
  }

  const markdown = formatConversationAsMarkdown(messages, throughMessageId);
  const clipboard = tab.dom.messagesEl.ownerDocument.defaultView?.navigator.clipboard;
  if (clipboard?.writeText && markdown) await clipboard.writeText(markdown);
}

export function createMessagePresentation(
  tab: TabData,
  sessions: ChatPorts['sessions'],
  publishViewportHandle: (handle: MessageViewportHandle | null) => void,
): MessagePresentationRuntime {
  const renderer = tab.renderer;
  if (!renderer) throw new Error('Message presentation requires an initialized renderer');
  let viewportHandle: MessageViewportHandle | null = null;
  const markdownAdapter = createStreamingMarkdownContentAdapter(
    renderer.component,
    (target, markdown, options) => renderer.renderContent(target, markdown, options),
    tab.state.projectionStore.perfRecorder,
  );
  const userContentAdapter = createReplacingContentAdapter<ChatMessage>(
    (target, message) => {
      const text = message.displayContent ?? message.content;
      return text
        ? tab.renderer?.renderUserMessageText(target, text, message.turnRequest)
        : undefined;
    },
  );
  const toolContentAdapter = createReplacingContentAdapter<ToolCallInfo>(
    (target, toolCall) => renderToolContent(target, toolCall, undefined, {
      renderMarkdown: (preview, markdown, sourcePath) => (
        tab.renderer?.renderContent(preview, markdown, { sourcePath }) ?? Promise.resolve()
      ),
    }),
  );
  const askUserContentAdapter = createReplacingContentAdapter<ToolCallInfo>(
    (target, toolCall) => renderToolContent(target, toolCall),
  );
  return {
    actions: {
      canCopy: message => getMessageCopyContent(message).length > 0,
      canFork: message => !!getForkEntryId(message) && !hasPendingAsyncSubagent(message),
      canRedo: messageId => {
        const index = tab.state.messages.findIndex(message => message.id === messageId);
        const message = tab.state.messages[index];
        return !!message
          && findRedoContext(tab.state.messages, index) !== null
          && !hasPendingAsyncSubagent(message);
      },
      copy: message => copyMessage(tab, message),
      copyConversationAsMarkdown: messageId => (
        copyConversationAsMarkdown(tab, sessions, messageId)
      ),
      fork: messageId => tab.renderer?.forkCallback?.(messageId),
      redo: messageId => tab.renderer?.redoCallback?.(messageId),
      scrollToRecentUser: messageId => viewportHandle?.scrollToRecentUser(messageId),
    },
    loadPreviousPage: async () => {
      try {
        if (tab.state.prependPreviousProjectionPage()) return true;
        return await (tab.controllers.openSessionController?.loadOlderMessages()
          ?? Promise.resolve(false));
      } catch (error) {
        logger.warn('Failed to load older session messages', error);
        return false;
      }
    },
    setViewportHandle: handle => {
      viewportHandle = handle;
      publishViewportHandle(handle);
    },
    contentAdapters: {
      markdown: markdownAdapter,
      userContent: userContentAdapter,
      tool: toolContentAdapter,
      askUser: askUserContentAdapter,
      subagent: createSubagentContentAdapter(async (target, markdown, options) => {
        await tab.renderer?.renderContent(target, markdown, options);
      }),
    },
  };
}

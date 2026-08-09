import type { ChatMessage } from '@pivi/agent/foundation';
import { PluginLogger } from '@pivi/agent/foundation/pluginLogger';
import type { ChatPorts } from '@pivi/agent/runtime/chatPorts';
import type { MessageViewportHandle } from '@pivi/pivi-react';
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

let messageAdapterGeneration = 0;
const logger = new PluginLogger('ImperativeChatMessagePresentation');

function mountMessageContentAdapter(
  container: HTMLElement,
  generation: string,
  render: (target: HTMLElement) => Promise<void> | void,
): (() => void) {
  const token = `${generation}:${++messageAdapterGeneration}`;
  const staging = container.ownerDocument.win.createDiv();
  container.dataset.piviRenderGeneration = token;
  let disposed = false;
  void Promise.resolve(render(staging)).then(() => {
    if (disposed || container.dataset.piviRenderGeneration !== token) return;
    container.replaceChildren(...Array.from(staging.childNodes));
  });
  return () => {
    disposed = true;
    staging.replaceChildren();
    if (container.dataset.piviRenderGeneration !== token) return;
    delete container.dataset.piviRenderGeneration;
    container.replaceChildren();
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
      userContent: {
        mount: (container, message, context) => {
          const text = message.displayContent ?? message.content;
          return mountMessageContentAdapter(
            container,
            context.generation,
            target => text
              ? tab.renderer?.renderUserMessageText(target, text, message.turnRequest)
              : undefined,
          );
        },
      },
      tool: {
        mount: (container, toolCall, context) => mountMessageContentAdapter(
          container,
          context.generation,
          target => renderToolContent(target, toolCall, undefined, {
            renderMarkdown: (preview, markdown, sourcePath) => (
              tab.renderer?.renderContent(preview, markdown, { sourcePath }) ?? Promise.resolve()
            ),
          }),
        ),
      },
      askUser: {
        mount: (container, toolCall) => {
          void renderToolContent(container, toolCall);
          return () => container.empty();
        },
      },
      subagent: createSubagentContentAdapter(async (target, markdown, options) => {
        await tab.renderer?.renderContent(target, markdown, options);
      }),
    },
  };
}

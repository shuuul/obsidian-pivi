import type { ChatMessage } from '@pivi/pivi-agent-core/foundation';
import type { MessagePresentationRuntime } from '@pivi/pivi-react/mount';

import { createSubagentContentAdapter } from '@/app/ui/createSubagentContentAdapter';
import { findRedoContext } from '@/ui/chat/branchContext';
import {
  getForkEntryId,
  getMessageCopyContent,
  hasPendingAsyncSubagent,
} from '@/ui/chat/rendering/messageRendererActions';
import { renderToolContent } from '@/ui/chat/rendering/ToolCallRenderer';
import type { TabData } from '@/ui/chat/tabs/types';

let messageAdapterGeneration = 0;

export function mountMessageContentAdapter(
  container: HTMLElement,
  generation: string,
  render: (target: HTMLElement) => Promise<void> | void,
): (() => void) {
  const token = `${generation}:${++messageAdapterGeneration}`;
  const staging = container.ownerDocument.createElement('div');
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

export async function copyMessage(tab: TabData, message: ChatMessage): Promise<void> {
  const content = getMessageCopyContent(message);
  const clipboard = tab.dom.messagesEl.ownerDocument.defaultView?.navigator.clipboard;
  if (clipboard?.writeText) await clipboard.writeText(content);
}

export function createMessagePresentation(
  tab: TabData,
  scrollActiveUserMessage: (direction: 'prev' | 'next') => void,
): MessagePresentationRuntime {
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
      fork: messageId => tab.renderer?.forkCallback?.(messageId),
      redo: messageId => tab.renderer?.redoCallback?.(messageId),
      scrollToRecentUser: () => scrollActiveUserMessage('prev'),
    },
    contentAdapters: {
      markdown: {
        mount: (container, markdown, context) => mountMessageContentAdapter(
          container,
          context.generation,
          target => tab.renderer?.renderContent(target, markdown),
        ),
      },
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

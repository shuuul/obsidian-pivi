import { memo, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';

import type { MessagePresentationActions } from '../../chat/messages';
import { MessageList } from '../../chat/messages';
import type { ActiveChatUiBridge } from '../activeChatUiBridge';
import { ComposerChrome } from '../composer';
import type { ChatShellOptions } from '../types';
import { useActiveChatUiSlice } from '../useActiveChatUiSlice';
import { EMPTY_MESSAGE_ACTIONS, EMPTY_SURFACE_ACTIONS } from './constants';
import { NavigationSurface } from './NavigationSurface';
import { QueueIndicator } from './QueueIndicator';
import { TodoSurface } from './TodoSurface';
import { WelcomeSurface } from './WelcomeSurface';

const WELCOME_SLICE_KEYS = ['welcomeGreeting'] as const;
const QUEUE_SLICE_KEYS = ['queuedTurn'] as const;
const TODO_SLICE_KEYS = ['currentTodoVisualizationModel'] as const;
const NAVIGATION_SLICE_KEYS = ['autoScrollEnabled', 'navigationVisible'] as const;
const COMPOSER_SLICE_KEYS = ['composer', 'externalContext', 'usage', 'isStreaming'] as const;
const MESSAGES_SLICE_KEYS = ['isStreaming', 'autoScrollEnabled', 'thinkingIndicator', 'hasOlderMessages'] as const;

function usePortalTargets(activeChat: ActiveChatUiBridge) {
  return useSyncExternalStore(
    activeChat.subscribe,
    activeChat.getPortalTargets,
    activeChat.getPortalTargets,
  );
}

function useComposerActions(activeChat: ActiveChatUiBridge) {
  return useSyncExternalStore(
    activeChat.subscribe,
    activeChat.getComposerActions,
    activeChat.getComposerActions,
  );
}

function useMessagePresentation(activeChat: ActiveChatUiBridge) {
  return useSyncExternalStore(
    activeChat.subscribe,
    activeChat.getMessagePresentation,
    activeChat.getMessagePresentation,
  );
}

function useProjectionStore(activeChat: ActiveChatUiBridge) {
  return useSyncExternalStore(
    activeChat.subscribe,
    activeChat.getProjectionStore,
    activeChat.getProjectionStore,
  );
}

function useHasMessages(activeChat: ActiveChatUiBridge): boolean {
  const projectionStore = useProjectionStore(activeChat);
  return useSyncExternalStore(
    projectionStore?.subscribeOrder ?? (() => () => {}),
    () => (projectionStore?.getOrderSnapshot().length ?? 0) > 0,
    () => (projectionStore?.getOrderSnapshot().length ?? 0) > 0,
  );
}

const WelcomePortal = memo(function WelcomePortal({
  activeChat,
  quoteAdapter,
}: {
  activeChat: ActiveChatUiBridge;
  quoteAdapter?: ChatShellOptions['welcomeQuoteAdapter'];
}) {
  const snapshot = useActiveChatUiSlice(activeChat, WELCOME_SLICE_KEYS);
  const hasMessages = useHasMessages(activeChat);
  const targets = usePortalTargets(activeChat);
  if (!targets?.welcome) return null;
  const greeting = hasMessages ? null : snapshot.welcomeGreeting;
  return createPortal(
    <WelcomeSurface greeting={greeting} quoteAdapter={quoteAdapter} />,
    targets.welcome,
  );
});

const QueuePortal = memo(function QueuePortal({
  activeChat,
  surfaceActions,
}: {
  activeChat: ActiveChatUiBridge;
  surfaceActions: ChatShellOptions['surfaceActions'];
}) {
  const snapshot = useActiveChatUiSlice(activeChat, QUEUE_SLICE_KEYS);
  const targets = usePortalTargets(activeChat);
  if (!targets?.queue) return null;
  const actions = surfaceActions ?? EMPTY_SURFACE_ACTIONS;
  return createPortal(
    <QueueIndicator actions={actions} queuedTurn={snapshot.queuedTurn} />,
    targets.queue,
  );
});

const TodoPortal = memo(function TodoPortal({
  activeChat,
}: {
  activeChat: ActiveChatUiBridge;
}) {
  const snapshot = useActiveChatUiSlice(activeChat, TODO_SLICE_KEYS);
  const targets = usePortalTargets(activeChat);
  if (!targets?.todo) return null;
  return createPortal(
    <TodoSurface model={snapshot.currentTodoVisualizationModel} />,
    targets.todo,
  );
});

const NavigationPortal = memo(function NavigationPortal({
  activeChat,
  surfaceActions,
}: {
  activeChat: ActiveChatUiBridge;
  surfaceActions: ChatShellOptions['surfaceActions'];
}) {
  const snapshot = useActiveChatUiSlice(activeChat, NAVIGATION_SLICE_KEYS);
  const targets = usePortalTargets(activeChat);
  if (!targets?.navigation) return null;
  const actions = surfaceActions ?? EMPTY_SURFACE_ACTIONS;
  return createPortal(
    <NavigationSurface
      actions={actions}
      autoScrollEnabled={snapshot.autoScrollEnabled}
      visible={snapshot.navigationVisible}
    />,
    targets.navigation,
  );
});

const ComposerPortal = memo(function ComposerPortal({
  activeChat,
}: {
  activeChat: ActiveChatUiBridge;
}) {
  const snapshot = useActiveChatUiSlice(activeChat, COMPOSER_SLICE_KEYS);
  const targets = usePortalTargets(activeChat);
  const composerActions = useComposerActions(activeChat);
  if (!targets?.composer) return null;
  return createPortal(
    <ComposerChrome actions={composerActions} key={targets.composer.dataset.tabId} snapshot={snapshot} />,
    targets.composer,
  );
});

const MessagesPortal = memo(function MessagesPortal({
  activeChat,
}: {
  activeChat: ActiveChatUiBridge;
}) {
  const snapshot = useActiveChatUiSlice(activeChat, MESSAGES_SLICE_KEYS);
  const targets = usePortalTargets(activeChat);
  const messagePresentation = useMessagePresentation(activeChat);
  const projectionStore = useProjectionStore(activeChat);
  if (!targets?.messages || !targets.messagesViewport || !projectionStore) return null;
  const actions: MessagePresentationActions = messagePresentation?.actions ?? EMPTY_MESSAGE_ACTIONS;
  return createPortal(
    <>
      <MessageList
        actions={actions}
        autoScrollEnabled={snapshot.autoScrollEnabled}
        contentAdapters={messagePresentation?.contentAdapters}
        hasOlderMessages={snapshot.hasOlderMessages}
        isStreaming={snapshot.isStreaming}
        onLoadPreviousPage={messagePresentation?.loadPreviousPage}
        onViewportHandle={messagePresentation?.setViewportHandle}
        scrollElement={targets.messagesViewport}
        store={projectionStore}
        thinkingIndicator={snapshot.thinkingIndicator}
      />
    </>,
    targets.messages,
  );
});

export const ConnectedActiveTabSurfaces = memo(function ConnectedActiveTabSurfaces({
  activeChat,
  shell,
}: {
  activeChat: ActiveChatUiBridge;
  shell: ChatShellOptions;
}) {
  const targets = usePortalTargets(activeChat);
  if (!targets) return null;
  return (
    <>
      <WelcomePortal activeChat={activeChat} quoteAdapter={shell.welcomeQuoteAdapter} />
      <QueuePortal activeChat={activeChat} surfaceActions={shell.surfaceActions} />
      <TodoPortal activeChat={activeChat} />
      <NavigationPortal activeChat={activeChat} surfaceActions={shell.surfaceActions} />
      <ComposerPortal activeChat={activeChat} />
      <MessagesPortal activeChat={activeChat} />
    </>
  );
});

export function ActiveTabSurfaces({ shell }: { shell: ChatShellOptions }) {
  return shell.activeChat
    ? <ConnectedActiveTabSurfaces activeChat={shell.activeChat} shell={shell} />
    : null;
}

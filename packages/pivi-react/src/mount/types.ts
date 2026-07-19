import type { ChatTabActions, ChatTabsStore } from '../store';
import type { ActiveChatUiBridge } from './activeChatUiBridge';

export interface ChatSurfaceActions {
  steerQueuedTurn: (id: string) => void;
  editQueuedTurn: (id: string) => void;
  discardQueuedTurn: (id: string) => void;
  reorderQueuedTurns: (ids: readonly string[]) => void;
  scrollToTop: () => void;
  scrollToPreviousUserMessage: () => void;
  scrollToNextUserMessage: () => void;
  scrollToBottom: () => void;
  resumeAutoScroll: () => void;
}

export interface WelcomeQuoteAdapter {
  mount: (container: HTMLElement) => () => void;
}

export interface ChatShellOptions {
  store: ChatTabsStore;
  actions: ChatTabActions;
  inputPortalContainer: HTMLElement;
  activeChat?: ActiveChatUiBridge;
  surfaceActions?: ChatSurfaceActions;
  welcomeQuoteAdapter?: WelcomeQuoteAdapter;
}

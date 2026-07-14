import type { ChatTabActions, ChatTabsStore } from '../store';
import type { ActiveChatUiBridge } from './activeChatUiBridge';

export interface ChatSurfaceActions {
  editQueuedTurn: () => void;
  discardQueuedTurn: () => void;
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

import type { MessagePresentationActions } from '../../chat/messages';
import type { ChatSurfaceActions } from '../types';

export const EMPTY_SURFACE_ACTIONS: ChatSurfaceActions = {
  steerQueuedTurn: () => {},
  editQueuedTurn: () => {},
  discardQueuedTurn: () => {},
  reorderQueuedTurns: () => {},
  scrollToTop: () => {},
  scrollToPreviousUserMessage: () => {},
  scrollToNextUserMessage: () => {},
  scrollToBottom: () => {},
  resumeAutoScroll: () => {},
};

export const EMPTY_MESSAGE_ACTIONS: MessagePresentationActions = {
  canCopy: () => false,
  canFork: () => false,
  canRedo: () => false,
  copy: () => {},
  fork: () => {},
  redo: () => {},
  scrollToRecentUser: () => {},
};

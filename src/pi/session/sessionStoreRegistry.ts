import type { SessionStore } from '../../core/session/types';

let sessionStore: SessionStore | null = null;

export function setSessionStore(store: SessionStore): void {
  sessionStore = store;
}

export function getSessionStore(): SessionStore {
  if (!sessionStore) {
    throw new Error('SessionStore is not initialized');
  }
  return sessionStore;
}

export function tryGetSessionStore(): SessionStore | null {
  return sessionStore;
}

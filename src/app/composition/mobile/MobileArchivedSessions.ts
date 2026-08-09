import type { App } from 'obsidian';

export const MOBILE_ARCHIVED_SESSIONS_STORAGE_KEY = 'pivi.mobile.archived-sessions.v1';

/** Device-local UI state. Session files remain unchanged and continue to sync. */
export class MobileArchivedSessions {
  constructor(private readonly app: App) {}

  load(): Set<string> {
    const value: unknown = this.app.loadLocalStorage(MOBILE_ARCHIVED_SESSIONS_STORAGE_KEY);
    if (!Array.isArray(value)) return new Set();
    return new Set(value.filter((item): item is string => typeof item === 'string'));
  }

  save(files: ReadonlySet<string>): void {
    this.app.saveLocalStorage(MOBILE_ARCHIVED_SESSIONS_STORAGE_KEY, [...files].sort());
  }
}

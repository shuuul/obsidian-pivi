import type {
  SessionJournalStateV1,
  SessionJournalStore,
} from '@pivi/pivi-agent-core/session/sessionJournal';
import {
  assertSupportedSessionJournalVersion,
  normalizeSessionJournalState,
} from '@pivi/pivi-agent-core/session/sessionJournal';
import type { App } from 'obsidian';

export const DEVICE_LOCAL_SESSION_JOURNAL_STORAGE_KEY = 'pivi.session-journal.v1';

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function readStored(app: App): Record<string, unknown> | null {
  const raw: unknown = app.loadLocalStorage(DEVICE_LOCAL_SESSION_JOURNAL_STORAGE_KEY);
  if (!raw || !isRecord(raw)) {
    return null;
  }
  return raw;
}

export class ObsidianDeviceLocalSessionJournalStore implements SessionJournalStore {
  constructor(private readonly app: App) {}

  load(): SessionJournalStateV1 {
    const stored = readStored(this.app);
    if (!stored) {
      return normalizeSessionJournalState(null);
    }
    assertSupportedSessionJournalVersion(stored.version);
    return normalizeSessionJournalState(stored);
  }

  save(state: SessionJournalStateV1): void {
    const normalized = normalizeSessionJournalState({
      ...state,
      version: 1,
    });
    this.app.saveLocalStorage(DEVICE_LOCAL_SESSION_JOURNAL_STORAGE_KEY, normalized);
  }
}

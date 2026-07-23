import { PluginLogger } from '@pivi/pivi-agent-core/foundation/pluginLogger';
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

const logger = new PluginLogger('SessionJournalStore');

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export class ObsidianDeviceLocalSessionJournalStore implements SessionJournalStore {
  constructor(private readonly app: App) {}

  load(): SessionJournalStateV1 {
    const raw: unknown = this.app.loadLocalStorage(DEVICE_LOCAL_SESSION_JOURNAL_STORAGE_KEY);
    if (!raw) {
      return normalizeSessionJournalState(null);
    }
    if (!isRecord(raw)) {
      // A non-empty, non-record blob means device-local storage was corrupted.
      // Reset to empty (recovery history is lost) but surface it so it is not silent.
      logger.warn('Session journal storage was corrupt; resetting to an empty journal.');
      return normalizeSessionJournalState(null);
    }
    assertSupportedSessionJournalVersion(raw.version);
    return normalizeSessionJournalState(raw);
  }

  save(state: SessionJournalStateV1): void {
    const normalized = normalizeSessionJournalState({
      ...state,
      version: 1,
    });
    this.app.saveLocalStorage(DEVICE_LOCAL_SESSION_JOURNAL_STORAGE_KEY, normalized);
  }
}

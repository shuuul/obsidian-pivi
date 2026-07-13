import type { DeviceLocalExternalContextStore } from '@pivi/pivi-agent-core/session';
import type { App } from 'obsidian';

export const DEVICE_LOCAL_EXTERNAL_CONTEXT_STORAGE_KEY = 'pivi.external-contexts.v1';

interface StoredSessionExternalContexts {
  selectedPaths?: string[];
  turns?: Record<string, string[]>;
}

interface StoredExternalContexts {
  version: 1;
  externalReadDirectories: string[];
  sessions: Record<string, StoredSessionExternalContexts>;
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return [...new Set(value
    .filter((entry): entry is string => typeof entry === 'string')
    .map(entry => entry.trim())
    .filter(Boolean))];
}

function readStored(app: App): StoredExternalContexts {
  const raw: unknown = app.loadLocalStorage(DEVICE_LOCAL_EXTERNAL_CONTEXT_STORAGE_KEY);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { version: 1, externalReadDirectories: [], sessions: {} };
  }

  const record = raw as Record<string, unknown>;
  const rawSessions = record.sessions;
  const sessions: Record<string, StoredSessionExternalContexts> = {};
  if (rawSessions && typeof rawSessions === 'object' && !Array.isArray(rawSessions)) {
    for (const [sessionFile, value] of Object.entries(rawSessions)) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        continue;
      }
      const session = value as Record<string, unknown>;
      const turns: Record<string, string[]> = {};
      if (session.turns && typeof session.turns === 'object' && !Array.isArray(session.turns)) {
        for (const [entryId, paths] of Object.entries(session.turns)) {
          const normalized = stringList(paths);
          if (normalized.length > 0) {
            turns[entryId] = normalized;
          }
        }
      }
      const selectedPaths = stringList(session.selectedPaths);
      if (selectedPaths.length > 0 || Object.keys(turns).length > 0) {
        sessions[sessionFile] = {
          ...(selectedPaths.length > 0 ? { selectedPaths } : {}),
          ...(Object.keys(turns).length > 0 ? { turns } : {}),
        };
      }
    }
  }

  return {
    version: 1,
    externalReadDirectories: stringList(record.externalReadDirectories),
    sessions,
  };
}

function writeStored(app: App, stored: StoredExternalContexts): void {
  app.saveLocalStorage(DEVICE_LOCAL_EXTERNAL_CONTEXT_STORAGE_KEY, stored);
}

export class ObsidianDeviceLocalExternalContextStore
implements DeviceLocalExternalContextStore {
  constructor(private readonly app: App) {}

  getExternalReadDirectories(): string[] {
    return [...readStored(this.app).externalReadDirectories];
  }

  setExternalReadDirectories(paths: readonly string[]): void {
    const stored = readStored(this.app);
    stored.externalReadDirectories = stringList(paths);
    writeStored(this.app, stored);
  }

  getSessionPaths(sessionFile: string): string[] {
    return [...(readStored(this.app).sessions[sessionFile]?.selectedPaths ?? [])];
  }

  setSessionPaths(sessionFile: string, paths: readonly string[]): void {
    const stored = readStored(this.app);
    const session = stored.sessions[sessionFile] ?? {};
    const selectedPaths = stringList(paths);
    if (selectedPaths.length > 0) {
      session.selectedPaths = selectedPaths;
    } else {
      delete session.selectedPaths;
    }
    this.writeSession(stored, sessionFile, session);
  }

  getTurnPaths(sessionFile: string, entryId: string): string[] {
    return [...(readStored(this.app).sessions[sessionFile]?.turns?.[entryId] ?? [])];
  }

  setTurnPaths(sessionFile: string, entryId: string, paths: readonly string[]): void {
    const stored = readStored(this.app);
    const session = stored.sessions[sessionFile] ?? {};
    const turns = { ...(session.turns ?? {}) };
    const nextPaths = stringList(paths);
    if (nextPaths.length > 0) {
      turns[entryId] = nextPaths;
    } else {
      delete turns[entryId];
    }
    session.turns = turns;
    this.writeSession(stored, sessionFile, session);
  }

  copySession(sourceSessionFile: string, targetSessionFile: string): void {
    const stored = readStored(this.app);
    const source = stored.sessions[sourceSessionFile];
    if (!source) {
      return;
    }
    stored.sessions[targetSessionFile] = {
      ...(source.selectedPaths ? { selectedPaths: [...source.selectedPaths] } : {}),
      ...(source.turns ? {
        turns: Object.fromEntries(
          Object.entries(source.turns).map(([entryId, paths]) => [entryId, [...paths]]),
        ),
      } : {}),
    };
    writeStored(this.app, stored);
  }

  deleteSession(sessionFile: string): void {
    const stored = readStored(this.app);
    if (!Object.hasOwn(stored.sessions, sessionFile)) {
      return;
    }
    delete stored.sessions[sessionFile];
    writeStored(this.app, stored);
  }

  private writeSession(
    stored: StoredExternalContexts,
    sessionFile: string,
    session: StoredSessionExternalContexts,
  ): void {
    if ((session.selectedPaths?.length ?? 0) === 0 && Object.keys(session.turns ?? {}).length === 0) {
      delete stored.sessions[sessionFile];
    } else {
      stored.sessions[sessionFile] = session;
    }
    writeStored(this.app, stored);
  }
}

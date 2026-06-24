import type {
  AgentSettingsReconciler,
  SessionHistoryService,
  TaskResultInterpreter,
  TaskTerminalStatus,
} from '../core/agent/types';
import { QueryBackedInlineEditService } from '../core/auxiliary/QueryBackedInlineEditService';
import { QueryBackedTitleGenerationService } from '../core/auxiliary/QueryBackedTitleGenerationService';
import type { LeafSummary } from '../core/session/types';
import type { OpenSessionState } from '../core/types';
import type ObsiusPlugin from '../main';
import { PiAuxQueryRunner } from './runtime/PiAuxQueryRunner';
import { tryGetSessionStore } from './session/sessionStoreRegistry';

export class PiInlineEditService extends QueryBackedInlineEditService {
  constructor(plugin: ObsiusPlugin) {
    super(new PiAuxQueryRunner(plugin));
  }
}

export class PiTitleGenerationService extends QueryBackedTitleGenerationService {
  constructor(plugin: ObsiusPlugin) {
    super({
      createRunner: () => new PiAuxQueryRunner(plugin),
      resolveModel: () => plugin.settings.titleGenerationModel?.trim() || undefined,
    });
  }
}

export class PiTaskResultInterpreter implements TaskResultInterpreter {
  hasAsyncLaunchMarker(_toolUseResult: unknown): boolean {
    return false;
  }

  extractAgentId(_toolUseResult: unknown): string | null {
    return null;
  }

  extractStructuredResult(_toolUseResult: unknown): string | null {
    return null;
  }

  resolveTerminalStatus(
    _toolUseResult: unknown,
    fallbackStatus: TaskTerminalStatus,
  ): TaskTerminalStatus {
    return fallbackStatus;
  }

  extractTagValue(_payload: string, _tagName: string): string | null {
    return null;
  }
}

export class PiSessionHistoryService implements SessionHistoryService {
  async hydrateSessionHistory(
    openSession: OpenSessionState,
    _vaultPath: string | null,
    leafId?: string | null,
  ): Promise<void> {
    const store = tryGetSessionStore();
    if (!store || !openSession.sessionFile) {
      return;
    }

    const ref = store.sessionRefFromOpenSession(openSession);
    if (!ref) {
      return;
    }

    const activeLeaf = leafId ?? openSession.leafId ?? ref.leafId;
    const opened = await store.open(ref.sessionFile, activeLeaf || undefined);
    openSession.messages = await store.getMessages(opened);
    openSession.sessionId = opened.sessionId;
    openSession.leafId = opened.leafId;
    openSession.sessionFile = opened.sessionFile;

    const uiContext = await store.readUiContext(opened);
    openSession.currentNote = uiContext.currentNote;
    openSession.externalContextPaths = uiContext.externalContextPaths;
    openSession.enabledMcpServers = uiContext.enabledMcpServers;
  }

  async deleteSessionFile(
    openSession: OpenSessionState,
    _vaultPath: string | null,
  ): Promise<void> {
    if (!openSession.sessionFile) {
      return;
    }
    const store = tryGetSessionStore();
    if (!store) {
      return;
    }
    await store.deleteSession(openSession.sessionFile);
  }

  resolveSessionIdForOpenSession(openSession: OpenSessionState | null): string | null {
    return openSession?.sessionId ?? null;
  }

  isPendingForkSession(_openSession: OpenSessionState): boolean {
    return false;
  }

  async forkSession(
    openSession: OpenSessionState,
    atEntryId: string,
    _vaultPath: string | null,
  ): Promise<{ sessionFile: string; leafId: string; sessionId: string } | null> {
    const store = tryGetSessionStore();
    if (!store || !openSession.sessionFile) {
      return null;
    }
    const ref = store.sessionRefFromOpenSession(openSession);
    if (!ref) {
      return null;
    }
    const forked = await store.fork(ref, atEntryId);
    return {
      sessionFile: forked.sessionFile,
      leafId: forked.leafId,
      sessionId: forked.sessionId,
    };
  }

  async listLeaves(
    sessionFile: string,
    _vaultPath: string | null,
  ): Promise<LeafSummary[]> {
    const store = tryGetSessionStore();
    if (!store) {
      return [];
    }
    return store.listLeaves(sessionFile);
  }
}

export const agentSettingsReconciler: AgentSettingsReconciler = {
  reconcileModelWithEnvironment(_settings, _sessions) {
    return { changed: false, invalidatedSessions: [] };
  },
  normalizeModelVariantSettings(_settings) {
    return false;
  },
};

import type { OpenSessionState, SessionSummary } from "@pivi/agent/runtime";
import type { SessionMessagePage, SessionStore } from "@pivi/agent/session";
import type { OpenSessionManager } from "@pivi/agent/session/openSessionManager";
import type { PiviSettings } from "@pivi/agent/settings";
import type { SharedAppStorage } from "@pivi/obsidian-host/bootstrap/storage";
import type { App } from "obsidian";

import type { PiviChatView, SessionsFacade } from "@/app/hostContracts";
import { ensurePiviViewOpen } from "@/app/piviViewActivation";
import * as sessionApi from "@/app/pluginSessionApi";
import { readSessionTranscript } from "@/app/sessionTranscript";

export interface ApplicationSessionsDeps {
  app: App;
  sessionManager: OpenSessionManager;
  requireSessionStore(): SessionStore;
  getStorage(): SharedAppStorage;
  getSettings(): Pick<PiviSettings, 'chatViewPlacement' | 'deletedSessionRetentionDays'>;
  getAllViews(): PiviChatView[];
}

/**
 * Application-owned session operations behind the `sessions` facade. Every
 * operation that moves, restores, or purges session files runs through one
 * FIFO tail so trash moves and purges never interleave.
 */
export class ApplicationSessions implements SessionsFacade {
  private deletedSessionOperationTail: Promise<void> = Promise.resolve();

  constructor(private readonly deps: ApplicationSessionsDeps) {}

  readonly sessionRecovery: SessionsFacade['sessionRecovery'] = {
    read: async (sessionFile: string) => {
      const summary = this.deps.sessionManager.getAll()
        .find((session) => session.sessionFile === sessionFile);
      if (!summary) throw new Error(`Session not found: ${sessionFile}`);
      return readSessionTranscript({
        sessionFile,
        store: this.deps.requireSessionStore(),
      });
    },
    listDeleted: () => this.runDeletedSessionOperation(() => sessionApi.listDeletedSessions(
      this.context(),
      this.deps.getSettings().deletedSessionRetentionDays,
    )),
    restore: (sessionFile: string) => this.runDeletedSessionOperation(async () => {
      const restored = await sessionApi.restoreDeletedSession(
        this.context(),
        sessionFile,
        async (openSession) => {
          const view = await ensurePiviViewOpen(this.deps.app, this.deps.getSettings().chatViewPlacement);
          const opened = await view?.getChatHandle()?.commands.openSession(openSession.id) ?? false;
          if (!opened) throw new Error('Restored session could not be opened in a Pivi tab.');
        },
      );
      return {
        sessionId: restored.id,
        title: restored.title,
        sessionFile: restored.sessionFile ?? sessionFile,
      };
    }),
  };

  private runDeletedSessionOperation<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.deletedSessionOperationTail.then(operation, operation);
    this.deletedSessionOperationTail = result.then(() => undefined, () => undefined);
    return result;
  }

  private context(): sessionApi.PluginSessionContext {
    return {
      sessionManager: this.deps.sessionManager,
      requireSessionStore: () => this.deps.requireSessionStore(),
      storage: this.deps.getStorage(),
      getSessionList: () => this.getSessionList(),
      getAllViews: () => this.deps.getAllViews(),
      getSessions: () => this.deps.sessionManager.getAll(),
    };
  }

  forkSessionAt(
    openSession: OpenSessionState,
    atEntryId: string,
  ): Promise<{ sessionFile: string; sessionId: string } | null> {
    return sessionApi.forkSessionAt(this.context(), openSession, atEntryId);
  }

  createOpenSession(options?: {
    sessionId?: string;
    sessionFile?: string;
  }): Promise<OpenSessionState> {
    return sessionApi.createOpenSession(this.context(), options);
  }

  openSessionByFile(sessionFile: string): Promise<OpenSessionState> {
    return sessionApi.openSessionByFile(this.context(), sessionFile);
  }

  async deleteSession(id: string): Promise<void> {
    await this.runDeletedSessionOperation(() => sessionApi.deleteSession(this.context(), id));
  }

  async deleteSessionFile(sessionFile: string, openSessionId?: string | null): Promise<void> {
    await this.runDeletedSessionOperation(() => sessionApi.deleteSessionFile(
      this.context(),
      sessionFile,
      openSessionId,
    ));
  }

  async discardSessionFile(sessionFile: string, openSessionId?: string | null): Promise<void> {
    await this.runDeletedSessionOperation(() => sessionApi.discardSessionFile(
      this.context(),
      sessionFile,
      openSessionId,
    ));
  }

  abandonEmptyOwnedSession(sessionFile: string, openSessionId?: string | null): Promise<boolean> {
    return this.runDeletedSessionOperation(() => sessionApi.abandonEmptyOwnedSession(
      this.context(),
      sessionFile,
      openSessionId,
    ));
  }

  purgeDeletedSessionFiles(): Promise<number> {
    return this.runDeletedSessionOperation(() => (
      sessionApi.purgeDeletedSessionFiles(this.context())
    ));
  }

  purgeExpiredDeletedSessionFiles(): Promise<number> {
    return this.runDeletedSessionOperation(() => sessionApi.purgeExpiredDeletedSessionFiles(
      this.context(),
      this.deps.getSettings().deletedSessionRetentionDays,
    ));
  }

  loadSessionMaintenance(): Promise<{ archivedCount: number; deletedCount: number }> {
    return sessionApi.getSessionMaintenanceSnapshot(this.context());
  }

  deleteAllArchivedChats(): Promise<{ moved: number; skippedActive: number; failed: number }> {
    return this.runDeletedSessionOperation(() => sessionApi.deleteAllArchivedChats(this.context()));
  }

  async renameSession(
    id: string,
    title: string,
    titleSource?: OpenSessionState['titleSource'],
  ): Promise<void> {
    await sessionApi.renameSession(this.context(), id, title, titleSource);
  }

  async updateSession(
    id: string,
    updates: Partial<OpenSessionState>,
  ): Promise<void> {
    await sessionApi.updateSession(this.context(), id, updates);
  }

  getOpenSessionById(id: string): Promise<OpenSessionState | null> {
    return sessionApi.getOpenSessionById(this.context(), id);
  }

  openRecentSessionMessages(
    id: string,
    limit: number,
  ): Promise<SessionMessagePage | null> {
    return sessionApi.openRecentSessionMessages(this.context(), id, limit);
  }

  readOlderSessionMessages(
    id: string,
    beforeEntryId: string,
    limit: number,
  ): Promise<SessionMessagePage | null> {
    return sessionApi.readOlderSessionMessages(
      this.context(),
      id,
      beforeEntryId,
      limit,
    );
  }

  getOpenSessionSync(id: string): OpenSessionState | null {
    return sessionApi.getOpenSessionSync(this.context(), id);
  }

  findEmptySession(): OpenSessionState | null {
    return sessionApi.findEmptySession(this.context());
  }

  getSessionList(): SessionSummary[] {
    return sessionApi.getSessionList(this.context());
  }
}

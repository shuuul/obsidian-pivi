/**
 * Session CRUD and lifecycle helpers used by the plugin shell.
 * Keeps session orchestration out of the thin Obsidian Plugin class body.
 */
import type { AppTabManagerState } from "@pivi/obsidian-host/bootstrap/types";
import type { OpenSessionState, SessionSummary } from "@pivi/pivi-agent-core/foundation";
import type { LeafSummary, SessionStore } from "@pivi/pivi-agent-core/session";
import type { OpenSessionManager } from "@pivi/pivi-agent-core/session/openSessionManager";

import type { PiviChatView } from "./hostContracts";

export interface PluginSessionContext {
  sessionManager: OpenSessionManager;
  requireSessionStore(): SessionStore;
  storage: {
    getDeletedSessionFiles(): Promise<string[]>;
    setDeletedSessionFiles(files: string[]): Promise<void>;
    getTabManagerState(): Promise<AppTabManagerState | null>;
  };
  getSessionList(): SessionSummary[];
  getAllViews(): PiviChatView[];
  setSessions(sessions: OpenSessionState[]): void;
  getSessions(): OpenSessionState[];
}

export async function listSessionLeaves(
  ctx: PluginSessionContext,
  sessionFile: string,
): Promise<LeafSummary[]> {
  return ctx.requireSessionStore().listLeaves(sessionFile);
}

export async function forkSessionAt(
  ctx: PluginSessionContext,
  openSession: OpenSessionState,
  atEntryId: string,
): Promise<{ sessionFile: string; sessionId: string } | null> {
  const store = ctx.requireSessionStore();
  const ref = store.sessionRefFromOpenSession(openSession);
  if (!ref) {
    return null;
  }
  const forked = await store.fork(ref, atEntryId);
  return {
    sessionFile: forked.sessionFile,
    sessionId: forked.sessionId,
  };
}

export async function createOpenSession(
  ctx: PluginSessionContext,
  options?: {
    sessionId?: string;
    sessionFile?: string;
    leafId?: string | null;
  },
): Promise<OpenSessionState> {
  return ctx.sessionManager.create(options);
}

export async function openSessionByFile(
  ctx: PluginSessionContext,
  sessionFile: string,
): Promise<OpenSessionState> {
  return ctx.sessionManager.openByFile(sessionFile);
}

export async function switchSession(
  ctx: PluginSessionContext,
  id: string,
): Promise<OpenSessionState | null> {
  return ctx.sessionManager.switch(id);
}

export async function deleteSession(
  ctx: PluginSessionContext,
  id: string,
): Promise<void> {
  const deleted = await ctx.sessionManager.delete(id);
  if (!deleted) return;

  if (deleted.sessionFile) {
    await markSessionFileDeleted(ctx, deleted.sessionFile);
  }

  for (const view of ctx.getAllViews()) {
    const tabManager = view.getTabManager();
    if (!tabManager) continue;

    for (const tab of tabManager.getAllTabs()) {
      if (tab.openSessionId === id) {
        tab.controllers.inputController?.cancelStreaming();
        await tab.controllers.openSessionController?.createNew({
          force: true,
        });
      }
    }
  }
}

export async function purgeDeletedSessionFiles(
  ctx: PluginSessionContext,
): Promise<number> {
  const deletedSessionFiles = await ctx.storage.getDeletedSessionFiles();
  if (deletedSessionFiles.length === 0) {
    return 0;
  }

  const protectedSessionFiles = await getProtectedSessionFiles(ctx);
  const remainingDeletedSessionFiles: string[] = [];
  let deletedCount = 0;

  for (const sessionFile of deletedSessionFiles) {
    if (protectedSessionFiles.has(sessionFile)) {
      remainingDeletedSessionFiles.push(sessionFile);
      continue;
    }

    try {
      await ctx.requireSessionStore().deleteSession(sessionFile);
      deletedCount++;
    } catch {
      remainingDeletedSessionFiles.push(sessionFile);
    }
  }

  await ctx.storage.setDeletedSessionFiles(remainingDeletedSessionFiles);
  return deletedCount;
}

export async function hideDeletedSessionSummaries(
  ctx: PluginSessionContext,
): Promise<void> {
  const deletedSessionFiles = new Set(await ctx.storage.getDeletedSessionFiles());
  if (deletedSessionFiles.size === 0) {
    return;
  }

  ctx.setSessions(
    ctx.getSessions().filter(
      (session) => !session.sessionFile || !deletedSessionFiles.has(session.sessionFile),
    ),
  );
}

export async function renameSession(
  ctx: PluginSessionContext,
  id: string,
  title: string,
): Promise<void> {
  await ctx.sessionManager.rename(id, title);
}

export async function updateSession(
  ctx: PluginSessionContext,
  id: string,
  updates: Partial<OpenSessionState>,
): Promise<void> {
  await ctx.sessionManager.update(id, updates);
}

export async function getOpenSessionById(
  ctx: PluginSessionContext,
  id: string,
): Promise<OpenSessionState | null> {
  return ctx.sessionManager.getById(id);
}

export function getOpenSessionSync(
  ctx: PluginSessionContext,
  id: string,
): OpenSessionState | null {
  return ctx.sessionManager.getSync(id);
}

export function findEmptySession(ctx: PluginSessionContext): OpenSessionState | null {
  return ctx.sessionManager.findEmpty();
}

export function getSessionList(ctx: PluginSessionContext): SessionSummary[] {
  return ctx.sessionManager.list();
}

export function findSessionAcrossViews(
  views: PiviChatView[],
  openSessionId: string,
): { view: PiviChatView; tabId: string } | null {
  for (const view of views) {
    const tabManager = view.getTabManager();
    if (!tabManager) continue;

    for (const tab of tabManager.getAllTabs()) {
      if (tab.openSessionId === openSessionId) {
        return { view, tabId: tab.id };
      }
    }
  }
  return null;
}

async function markSessionFileDeleted(
  ctx: PluginSessionContext,
  sessionFile: string,
): Promise<void> {
  const deletedSessionFiles = await ctx.storage.getDeletedSessionFiles();
  if (deletedSessionFiles.includes(sessionFile)) {
    return;
  }
  await ctx.storage.setDeletedSessionFiles([...deletedSessionFiles, sessionFile]);
}

async function getProtectedSessionFiles(
  ctx: PluginSessionContext,
): Promise<Set<string>> {
  const protectedSessionFiles = new Set<string>();

  for (const session of ctx.getSessionList()) {
    if (session.sessionFile) {
      protectedSessionFiles.add(session.sessionFile);
    }
  }

  const persistedState = await ctx.storage.getTabManagerState();
  for (const tab of persistedState?.openTabs ?? []) {
    if (tab.sessionFile) {
      protectedSessionFiles.add(tab.sessionFile);
    }
  }

  for (const view of ctx.getAllViews()) {
    const tabManager = view.getTabManager();
    if (!tabManager) continue;
    for (const tab of tabManager.getAllTabs()) {
      if (tab.sessionFile) {
        protectedSessionFiles.add(tab.sessionFile);
      }
    }
  }

  return protectedSessionFiles;
}

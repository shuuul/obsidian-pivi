/**
 * Session CRUD and lifecycle helpers used by the plugin shell.
 * Keeps session orchestration out of the thin Obsidian Plugin class body.
 */
import { PluginLogger } from "@pivi/agent/logging/pluginLogger";
import type { OpenSessionState, SessionSummary } from "@pivi/agent/runtime";
import type { SessionMessagePage, SessionStore } from "@pivi/agent/session";
import type { OpenSessionManager } from "@pivi/agent/session/openSessionManager";
import { isVaultSessionFile } from "@pivi/agent/session/sessionPaths";
import type { AppTabManagerState } from "@pivi/obsidian-host/bootstrap/types";

import type { PiviChatView } from "./hostContracts";

const logger = new PluginLogger('PluginSessionApi');
const DAY_MS = 24 * 60 * 60 * 1000;

export interface DeletedSessionFileRecord {
  sessionFile: string;
  deletedAt: number;
}

export interface PluginSessionContext {
  sessionManager: OpenSessionManager;
  requireSessionStore(): SessionStore;
  storage: {
    getTabManagerState(): Promise<AppTabManagerState | null>;
    setTabManagerState(state: AppTabManagerState): Promise<void>;
  };
  getSessionList(): SessionSummary[];
  getAllViews(): PiviChatView[];
  getSessions(): OpenSessionState[];
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

export async function deleteSession(
  ctx: PluginSessionContext,
  id: string,
): Promise<void> {
  const session = ctx.sessionManager.getSync(id);
  if (!session) return;

  if (session.sessionFile) {
    await ctx.requireSessionStore().trashSession(session.sessionFile);
  }
  await ctx.sessionManager.delete(id);

  for (const view of ctx.getAllViews()) {
    await view.getChatHandle()?.maintenance.resetSession(id);
  }
}

export async function deleteSessionFile(
  ctx: PluginSessionContext,
  sessionFile: string,
  openSessionId?: string | null,
): Promise<void> {
  if (!isVaultSessionFile(sessionFile)) {
    throw new Error(`Invalid deleted session path: ${sessionFile}`);
  }
  await ctx.requireSessionStore().trashSession(sessionFile);
  if (!openSessionId) return;
  await ctx.sessionManager.delete(openSessionId);
  for (const view of ctx.getAllViews()) {
    await view.getChatHandle()?.maintenance.resetSession(openSessionId);
  }
}

/** Permanently compensates a session file created by a failed fork transaction. */
export async function discardSessionFile(
  ctx: PluginSessionContext,
  sessionFile: string,
  openSessionId?: string | null,
): Promise<void> {
  if (!isVaultSessionFile(sessionFile)) {
    throw new Error(`Invalid discarded session path: ${sessionFile}`);
  }

  const errors: unknown[] = [];
  if (openSessionId) {
    try {
      await ctx.sessionManager.delete(openSessionId);
    } catch (error) {
      errors.push(error);
    }
    for (const view of ctx.getAllViews()) {
      try {
        await view.getChatHandle()?.maintenance.resetSession(openSessionId);
      } catch (error) {
        errors.push(error);
      }
    }
  }
  try {
    await ctx.requireSessionStore().deleteSession(sessionFile);
  } catch (error) {
    errors.push(error);
  }

  if (errors.length > 0) {
    throw new AggregateError(errors, `Failed to discard session ${sessionFile}`);
  }
}

export async function abandonEmptyOwnedSession(
  ctx: PluginSessionContext,
  sessionFile: string,
  openSessionId?: string | null,
): Promise<boolean> {
  if (!ctx.sessionManager.ownsEmptySessionFile(sessionFile)) {
    return false;
  }
  await discardSessionFile(ctx, sessionFile, openSessionId);
  return true;
}

export async function purgeDeletedSessionFiles(
  ctx: PluginSessionContext,
): Promise<number> {
  return purgeDeletedSessionRecords(ctx, () => true);
}

export async function purgeExpiredDeletedSessionFiles(
  ctx: PluginSessionContext,
  retentionDays: number,
  now = Date.now(),
): Promise<number> {
  return purgeDeletedSessionRecords(
    ctx,
    (record) => now >= record.deletedAt + retentionDays * DAY_MS,
  );
}

async function purgeDeletedSessionRecords(
  ctx: PluginSessionContext,
  shouldPurge: (record: DeletedSessionFileRecord) => boolean,
): Promise<number> {
  const records = await ctx.requireSessionStore().listTrashedSessions();
  if (records.length === 0) {
    return 0;
  }

  const protectedSessionFiles = await getProtectedSessionFiles(ctx);
  let deletedCount = 0;

  for (const record of records) {
    const { sessionFile } = record;
    if (!shouldPurge(record) || protectedSessionFiles.has(sessionFile)) {
      continue;
    }
    if (!isVaultSessionFile(sessionFile)) {
      logger.warn(`Refusing to purge invalid session path ${sessionFile}`);
      continue;
    }

    try {
      await ctx.requireSessionStore().purgeTrashedSession(sessionFile);
      deletedCount++;
    } catch (error) {
      logger.warn(`Failed to purge deleted session ${sessionFile}`, error);
    }
  }

  return deletedCount;
}

export async function listDeletedSessions(
  ctx: PluginSessionContext,
  retentionDays: number,
): Promise<Array<DeletedSessionFileRecord & { expiresAt: number; retentionDays: number }>> {
  return (await ctx.requireSessionStore().listTrashedSessions()).map((record) => ({
    ...record,
    expiresAt: record.deletedAt + retentionDays * DAY_MS,
    retentionDays,
  }));
}

export async function restoreDeletedSession(
  ctx: PluginSessionContext,
  sessionFile: string,
  openVisibleSession?: (restored: OpenSessionState) => Promise<void>,
): Promise<OpenSessionState> {
  if (!isVaultSessionFile(sessionFile)) {
    throw new Error(`Invalid deleted session path: ${sessionFile}`);
  }
  const store = ctx.requireSessionStore();
  const records = await store.listTrashedSessions();
  if (!records.some((record) => record.sessionFile === sessionFile)) {
    throw new Error(`Session is not in trash: ${sessionFile}`);
  }
  await store.restoreTrashedSession(sessionFile);
  let restored: OpenSessionState;
  try {
    restored = await ctx.sessionManager.openByFile(sessionFile);
  } catch (error) {
    await store.trashSession(sessionFile).catch((trashError) => {
      logger.warn(`Failed to re-trash after restore open failure: ${sessionFile}`, trashError);
    });
    throw new Error(`Deleted session file is missing or unreadable: ${sessionFile}`, { cause: error });
  }
  await openVisibleSession?.(restored);
  return restored;
}

export async function relocateQueuedDeletedSessions(
  takeQueue: () => Promise<string[]>,
  sessionStore: SessionStore,
): Promise<void> {
  const files = await takeQueue();
  for (const sessionFile of files) {
    if (!isVaultSessionFile(sessionFile)) {
      continue;
    }
    try {
      await sessionStore.trashSession(sessionFile);
    } catch (error) {
      logger.warn(`Failed to relocate queued deleted session ${sessionFile}`, error);
    }
  }
}

export async function renameSession(
  ctx: PluginSessionContext,
  id: string,
  title: string,
  titleSource?: OpenSessionState['titleSource'],
): Promise<void> {
  await ctx.sessionManager.rename(id, title, titleSource);
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

export async function openRecentSessionMessages(
  ctx: PluginSessionContext,
  id: string,
  limit: number,
): Promise<SessionMessagePage | null> {
  return ctx.sessionManager.openRecent(id, limit);
}

export async function readOlderSessionMessages(
  ctx: PluginSessionContext,
  id: string,
  beforeEntryId: string,
  limit: number,
): Promise<SessionMessagePage | null> {
  return ctx.sessionManager.readOlder(id, beforeEntryId, limit);
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
    for (const sessionFile of view.getChatHandle()?.maintenance.getBoundSessionFiles() ?? []) {
      protectedSessionFiles.add(sessionFile);
    }
  }

  return protectedSessionFiles;
}

export async function getSessionMaintenanceSnapshot(
  ctx: PluginSessionContext,
): Promise<{ archivedCount: number; deletedCount: number }> {
  const archived = new Set<string>();
  const persistedState = await ctx.storage.getTabManagerState();
  for (const tab of persistedState?.openTabs ?? []) {
    if (tab.sessionFile && tab.isArchived === true) {
      archived.add(tab.sessionFile);
    }
  }
  for (const view of ctx.getAllViews()) {
    for (const binding of view.getChatHandle()?.maintenance.getSessionBindings() ?? []) {
      if (binding.archived) archived.add(binding.sessionFile);
    }
  }
  const deleted = new Set(
    (await ctx.requireSessionStore().listTrashedSessions()).map((record) => record.sessionFile),
  );
  return { archivedCount: archived.size, deletedCount: deleted.size };
}

export async function deleteAllArchivedChats(
  ctx: PluginSessionContext,
): Promise<{ moved: number; skippedActive: number; failed: number }> {
  const persistedState = await ctx.storage.getTabManagerState();
  const archived = new Set<string>();
  const protectedFiles = new Set<string>();

  for (const tab of persistedState?.openTabs ?? []) {
    if (!tab.sessionFile) continue;
    if (tab.isArchived === true) archived.add(tab.sessionFile);
    else protectedFiles.add(tab.sessionFile);
  }
  for (const view of ctx.getAllViews()) {
    for (const binding of view.getChatHandle()?.maintenance.getSessionBindings() ?? []) {
      if (binding.archived) archived.add(binding.sessionFile);
      else protectedFiles.add(binding.sessionFile);
    }
  }

  let moved = 0;
  let skippedActive = 0;
  let failed = 0;

  for (const sessionFile of archived) {
    if (protectedFiles.has(sessionFile)) {
      skippedActive += 1;
      continue;
    }
    try {
      for (const view of ctx.getAllViews()) {
        await view.getChatHandle()?.maintenance.removeArchivedBindings(sessionFile);
      }
      const nextState = await ctx.storage.getTabManagerState();
      if (nextState) {
        const openTabs = nextState.openTabs.filter((tab) => !(
          tab.isArchived === true && tab.sessionFile === sessionFile
        ));
        if (openTabs.length !== nextState.openTabs.length) {
          const activeTabId = openTabs.some((tab) => tab.tabId === nextState.activeTabId)
            ? nextState.activeTabId
            : (openTabs.find((tab) => tab.isArchived !== true)?.tabId ?? openTabs[0]?.tabId ?? null);
          await ctx.storage.setTabManagerState({ openTabs, activeTabId });
        }
      }
      await ctx.requireSessionStore().trashSession(sessionFile);
      const openSession = ctx.getSessions().find((session) => session.sessionFile === sessionFile);
      if (openSession) {
        await ctx.sessionManager.delete(openSession.id);
      }
      moved += 1;
    } catch {
      failed += 1;
    }
  }

  return { moved, skippedActive, failed };
}

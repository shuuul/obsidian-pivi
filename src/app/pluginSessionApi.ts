/**
 * Session CRUD and lifecycle helpers used by the plugin shell.
 * Keeps session orchestration out of the thin Obsidian Plugin class body.
 */
import type { OpenSessionState, SessionSummary } from "@pivi/agent/foundation";
import { PluginLogger } from "@pivi/agent/foundation/pluginLogger";
import type { SessionMessagePage, SessionStore } from "@pivi/agent/session";
import type { OpenSessionManager } from "@pivi/agent/session/openSessionManager";
import type { DeletedSessionFileRecord } from "@pivi/obsidian-host/bootstrap/storage";
import type { AppTabManagerState } from "@pivi/obsidian-host/bootstrap/types";

import type { PiviChatView } from "./hostContracts";

const logger = new PluginLogger('PluginSessionApi');
const DAY_MS = 24 * 60 * 60 * 1000;
const SESSION_FILE_PREFIX = '.pivi/sessions/';

function isSafeSessionFile(sessionFile: string): boolean {
  return sessionFile.startsWith(SESSION_FILE_PREFIX)
    && sessionFile.endsWith('.jsonl')
    && !sessionFile.includes('\\')
    && !sessionFile.includes('\0')
    && !sessionFile.split('/').includes('..');
}

export interface PluginSessionContext {
  sessionManager: OpenSessionManager;
  requireSessionStore(): SessionStore;
  storage: {
    getDeletedSessionFiles(): Promise<DeletedSessionFileRecord[]>;
    setDeletedSessionFiles(records: DeletedSessionFileRecord[]): Promise<void>;
    updateDeletedSessionFiles(
      update: (records: readonly DeletedSessionFileRecord[]) => DeletedSessionFileRecord[],
    ): Promise<void>;
    getTabManagerState(): Promise<AppTabManagerState | null>;
  };
  getSessionList(): SessionSummary[];
  getAllViews(): PiviChatView[];
  setSessions(sessions: OpenSessionState[]): void;
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
    await markSessionFileDeleted(ctx, session.sessionFile);
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
  if (!isSafeSessionFile(sessionFile)) {
    throw new Error(`Invalid deleted session path: ${sessionFile}`);
  }
  await markSessionFileDeleted(ctx, sessionFile);
  if (!openSessionId) return;
  await ctx.sessionManager.delete(openSessionId);
  for (const view of ctx.getAllViews()) {
    await view.getChatHandle()?.maintenance.resetSession(openSessionId);
  }
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
  // Physical deletes must finish before the queue write so a failed disk delete
  // keeps the recovery record. Queue membership itself is still committed
  // atomically so concurrent mark/restore cannot clobber surviving entries.
  const records = await ctx.storage.getDeletedSessionFiles();
  if (records.length === 0) {
    return 0;
  }

  const protectedSessionFiles = await getProtectedSessionFiles(ctx);
  const purgedFiles = new Set<string>();
  let deletedCount = 0;

  for (const record of records) {
    const { sessionFile } = record;
    if (!shouldPurge(record) || protectedSessionFiles.has(sessionFile)) {
      continue;
    }
    if (!isSafeSessionFile(sessionFile)) {
      logger.warn(`Refusing to purge invalid session path ${sessionFile}`);
      continue;
    }

    try {
      await ctx.requireSessionStore().deleteSession(sessionFile);
      purgedFiles.add(sessionFile);
      deletedCount++;
    } catch (error) {
      logger.warn(`Failed to purge deleted session ${sessionFile}`, error);
    }
  }

  if (purgedFiles.size > 0) {
    await ctx.storage.updateDeletedSessionFiles((current) => (
      current.filter((record) => !purgedFiles.has(record.sessionFile))
    ));
  }
  return deletedCount;
}

export async function listDeletedSessions(
  ctx: PluginSessionContext,
  retentionDays: number,
): Promise<Array<DeletedSessionFileRecord & { expiresAt: number; retentionDays: number }>> {
  return (await ctx.storage.getDeletedSessionFiles()).map((record) => ({
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
  if (!isSafeSessionFile(sessionFile)) {
    throw new Error(`Invalid deleted session path: ${sessionFile}`);
  }
  const records = await ctx.storage.getDeletedSessionFiles();
  if (!records.some((record) => record.sessionFile === sessionFile)) {
    throw new Error(`Session is not queued for recovery: ${sessionFile}`);
  }
  const wasOpen = ctx.getSessionList().some((session) => session.sessionFile === sessionFile);
  let restored: OpenSessionState;
  try {
    restored = await ctx.sessionManager.openByFile(sessionFile);
  } catch (error) {
    throw new Error(`Deleted session file is missing or unreadable: ${sessionFile}`, { cause: error });
  }
  try {
    // Open succeeds first; only then drop the recovery record. Removal is
    // atomic against concurrent queue mutations so sibling entries stay put.
    await ctx.storage.updateDeletedSessionFiles((current) => (
      current.filter((record) => record.sessionFile !== sessionFile)
    ));
  } catch (error) {
    if (!wasOpen) await ctx.sessionManager.delete(restored.id);
    throw error;
  }
  await openVisibleSession?.(restored);
  return restored;
}

export async function hideDeletedSessionSummaries(
  ctx: PluginSessionContext,
): Promise<void> {
  const deletedSessionFiles = new Set(
    (await ctx.storage.getDeletedSessionFiles()).map((record) => record.sessionFile),
  );
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

async function markSessionFileDeleted(
  ctx: PluginSessionContext,
  sessionFile: string,
): Promise<void> {
  await ctx.storage.updateDeletedSessionFiles((current) => {
    if (current.some((record) => record.sessionFile === sessionFile)) {
      return [...current];
    }
    return [...current, { sessionFile, deletedAt: Date.now() }];
  });
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

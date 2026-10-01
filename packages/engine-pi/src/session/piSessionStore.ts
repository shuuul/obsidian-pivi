import {
  existsSync,
  statSync,
  utimesSync,
} from 'node:fs';

import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { SessionEntry } from '@earendil-works/pi-coding-agent';
import { PluginLogger } from '@pivi/agent/logging/pluginLogger';
import type {
  ChatMessage,
  UsageInfo,
} from '@pivi/agent/runtime';
import { calculateContextEnvelope } from '@pivi/agent/runtime/usage';
import { sanitizeMessageUiForJsonl } from '@pivi/agent/session/messageUi';
import {
  getPiviSessionTrashRoot,
  toAbsoluteSessionPath,
  toLiveSessionFile,
  toTrashedSessionFile,
  toVaultRelativePath,
} from '@pivi/agent/session/sessionPaths';
import type {
  DeviceLocalExternalContextStore,
  FileStore,
  MessageUiPatch,
  SessionMessagePage,
  SessionMetaPatch,
  SessionRef,
  SessionStore,
  SessionUiContext,
  StoreSessionInfo,
} from '@pivi/agent/session/types';
import {
  PIVI_SESSION_META,
  PIVI_UI_CONTEXT,
  type PiviSessionMetaData,
  type PiviUiContextData,
  SessionIndexCorruptError,
  SessionIndexError,
} from '@pivi/agent/session/types';
import { loadRuntimeVaultSkills } from '@pivi/agent/skills/vault/loadVaultSkills';

import {
  applySkillDescriptions,
  collectMessageUiMap,
  entriesToChatMessages,
  firstUserMessagePreview,
  readSessionMetaFromBranch,
} from './messageMapper';
import { estimateActiveContextCategories } from './piContextCompaction';
import {
  arraysEqual,
  ExternalContextJsonlMigrationError,
  listJsonlFilesUnder,
  listVaultSessionJsonlFiles,
  MemoryExternalContextStore,
  mergeMessageUiPatch,
  parentVaultRelativePath,
  patchAlreadyPersisted,
  sessionMetaEqual,
  stripExternalContextsFromSessionJsonl,
} from './piSessionStoreSupport';
import {
  assertSessionJsonlSourceUnchanged,
  captureSessionJsonlSource,
  ensureSessionJsonlIndex,
  invalidateSessionJsonlIndex,
  loadSessionJsonlIndex,
  readSessionJsonlIndex,
  readSessionJsonlIndexedLine,
  validateSessionJsonlIndexSource,
} from './sessionJsonlIndex';
import {
  openRecentSessionJsonlMessages,
  readOlderSessionJsonlMessages,
} from './sessionJsonlRangeReader';
import { SessionTreeStore } from './sessionTreeStore';
import { usageInfoFromAssistantMessage } from './sessionUsageInfo';
export {
  stripExternalContextsFromSessionJsonl,
} from './piSessionStoreSupport';

const logger = new PluginLogger('PiSessionStore');

export class PiSessionStore implements SessionStore {
  private readonly externalContexts: DeviceLocalExternalContextStore;
  private readonly externalContextMigrations = new Map<string, Promise<boolean>>();

  constructor(
    private readonly adapter: FileStore,
    private readonly vaultPath: string,
    externalContexts?: DeviceLocalExternalContextStore,
  ) {
    this.externalContexts = externalContexts ?? new MemoryExternalContextStore();
  }

  async migrateDeviceLocalExternalContexts(): Promise<number> {
    const files = (await this.adapter.listFilesRecursive('.pivi/sessions'))
      .filter((file) => file.endsWith('.jsonl'));
    let migrated = 0;
    for (const sessionFile of files) {
      try {
        if (await this.migrateSessionFile(sessionFile)) {
          migrated += 1;
        }
      } catch (error) {
        if (!(error instanceof ExternalContextJsonlMigrationError)) {
          throw error;
        }
        logger.warn(`Skipped malformed session migration: ${error.message}`);
      }
    }
    return migrated;
  }

  private async migrateSessionFile(sessionFile: string): Promise<boolean> {
    const inFlight = this.externalContextMigrations.get(sessionFile);
    if (inFlight) return inFlight;
    const migration = this.performSessionFileMigration(sessionFile)
      .finally(() => this.externalContextMigrations.delete(sessionFile));
    this.externalContextMigrations.set(sessionFile, migration);
    return migration;
  }

  private async performSessionFileMigration(sessionFile: string): Promise<boolean> {
    const absoluteFile = toAbsoluteSessionPath(this.vaultPath, sessionFile);
    let index;
    try {
      index = loadSessionJsonlIndex(absoluteFile);
    } catch (error) {
      if (!(error instanceof SessionIndexError)) throw error;
      invalidateSessionJsonlIndex(absoluteFile);
      index = null;
    }
    if (index?.migrations.externalContexts === 1) {
      return false;
    }
    const source = index?.source ?? captureSessionJsonlSource(absoluteFile);
    const content = await this.adapter.read(sessionFile);
    const migration = stripExternalContextsFromSessionJsonl(content, sessionFile);
    if (index) {
      validateSessionJsonlIndexSource(index);
    } else {
      assertSessionJsonlSourceUnchanged(absoluteFile, source);
    }
    if (!migration.changed) {
      if (!index) {
        const cleanIndex = ensureSessionJsonlIndex(absoluteFile);
        if (cleanIndex.migrations.externalContexts === 1) return false;
      }
      throw new SessionIndexCorruptError(
        'External-context migration marker does not match the session JSONL',
        absoluteFile,
      );
    }
    if (migration.sessionPaths !== undefined) {
      this.externalContexts.setSessionPaths(sessionFile, migration.sessionPaths);
    }
    for (const [entryId, paths] of migration.turnPaths) {
      this.externalContexts.setTurnPaths(sessionFile, entryId, paths);
    }
    invalidateSessionJsonlIndex(absoluteFile);
    await this.adapter.write(sessionFile, migration.content);
    const migratedIndex = ensureSessionJsonlIndex(absoluteFile);
    if (migratedIndex.migrations.externalContexts !== 1) {
      throw new SessionIndexCorruptError(
        'External-context migration did not clear legacy JSONL fields',
        absoluteFile,
      );
    }
    return true;
  }

  private async migrateSessionFileIfPresent(sessionFile: string): Promise<void> {
    if (await this.adapter.exists(sessionFile)) {
      await this.migrateSessionFile(sessionFile);
    }
  }

  sessionRefFromOpenSession(openSession: {
    sessionFile?: string;
    leafId?: string | null;
    sessionId?: string | null;
    id: string;
  }): SessionRef | null {
    if (!openSession.sessionFile) {
      return null;
    }
    return {
      sessionFile: openSession.sessionFile,
      sessionId: openSession.sessionId ?? openSession.id,
    };
  }

  /** Live path if present, otherwise the mirrored trash copy used for recovery reads. */
  private readableSessionFile(sessionFile: string): string {
    const relative = toVaultRelativePath(this.vaultPath, sessionFile);
    if (existsSync(toAbsoluteSessionPath(this.vaultPath, relative))) {
      return relative;
    }
    try {
      const trashed = toTrashedSessionFile(relative);
      if (existsSync(toAbsoluteSessionPath(this.vaultPath, trashed))) {
        return trashed;
      }
    } catch {
      // Not a vault session identity; callers still use the original relative path.
    }
    return relative;
  }

  private refFromStore(store: SessionTreeStore): SessionRef {
    const sessionFile = store.getVaultRelativeSessionFile();
    if (!sessionFile) {
      throw new Error("Session file is missing");
    }
    return {
      sessionFile,
      sessionId: store.getSessionId(),
    };
  }

  async listSessions(vaultPath: string): Promise<StoreSessionInfo[]> {
    const summaries: StoreSessionInfo[] = [];
    const files = listVaultSessionJsonlFiles(vaultPath);
    for (const absoluteFile of files) {
      try {
        const sessionFile = toVaultRelativePath(vaultPath, absoluteFile);
        const index = readSessionJsonlIndex(absoluteFile);
        const firstUserLine = index.entries.find(line => (
          line.entryType === 'message' && line.role === 'user'
        ));
        const messagePreview = firstUserLine
          ? firstUserMessagePreview([
              readSessionJsonlIndexedLine(index, firstUserLine) as unknown as SessionEntry,
            ])
          : 'New session';
        const metaLine = [...index.entries].reverse().find(line => (
          line.customType === PIVI_SESSION_META
        ));
        const meta = metaLine
          ? (readSessionJsonlIndexedLine(index, metaLine).data as PiviSessionMetaData | undefined)
          : undefined;
        const range = openRecentSessionJsonlMessages(absoluteFile, 1);
        const stat = statSync(absoluteFile);
        const updatedAt = meta?.lastResponseAt ?? stat.mtimeMs;
        const hasPersistedUserMessage = !!firstUserLine;
        summaries.push({
          sessionFile,
          sessionId: index.header.id,
          title: meta?.title || messagePreview,
          ...(meta?.titleSource ? { titleSource: meta.titleSource } : {}),
          updatedAt,
          leafCount: 1,
          messagePreview,
          messageCount: range.totalMessageCount,
          hasPersistedUserMessage,
          mtimeMs: stat.mtimeMs,
        });
      } catch {
        // Ignore malformed or concurrently removed session files.
      }
    }

    return summaries.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  create(vaultPath: string): Promise<SessionRef> {
    const store = SessionTreeStore.create(vaultPath);
    const now = Date.now();
    store.appendCustomMeta({
      title: new Date(now).toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      }),
      titleSource: 'timestamp',
      createdAt: now,
    });
    return Promise.resolve(this.refFromStore(store));
  }

  async open(sessionFile: string): Promise<SessionRef> {
    await this.migrateSessionFileIfPresent(sessionFile);
    const relativeFile = toVaultRelativePath(this.vaultPath, sessionFile);
    const index = readSessionJsonlIndex(
      toAbsoluteSessionPath(this.vaultPath, this.readableSessionFile(relativeFile)),
    );
    return {
      sessionFile: relativeFile,
      sessionId: index.header.id,
    };
  }

  async getMessages(ref: SessionRef): Promise<ChatMessage[]> {
    await this.migrateSessionFileIfPresent(ref.sessionFile);
    const store = SessionTreeStore.openSnapshot(
      this.vaultPath,
      this.readableSessionFile(ref.sessionFile),
    );
    const prefix = store.getLinearVisiblePrefix();
    const uiMap = collectMessageUiMap(store.getEntries());
    const messages = entriesToChatMessages(prefix, uiMap);
    return this.applyMessageReadOverlays(messages, ref.sessionFile);
  }

  async openRecent(ref: SessionRef, limit: number): Promise<SessionMessagePage> {
    await this.migrateSessionFileIfPresent(ref.sessionFile);
    const result = openRecentSessionJsonlMessages(
      toAbsoluteSessionPath(this.vaultPath, this.readableSessionFile(ref.sessionFile)),
      limit,
    );
    return {
      messages: this.applyMessageReadOverlays(result.messages, ref.sessionFile),
      hasOlder: result.hasOlder,
      totalMessageCount: result.totalMessageCount,
      olderMessageCount: result.olderMessageCount,
      olderUserMessageCount: result.olderUserMessageCount,
    };
  }

  async readOlder(
    ref: SessionRef,
    beforeEntryId: string,
    limit: number,
  ): Promise<SessionMessagePage> {
    await this.migrateSessionFileIfPresent(ref.sessionFile);
    const result = readOlderSessionJsonlMessages(
      toAbsoluteSessionPath(this.vaultPath, this.readableSessionFile(ref.sessionFile)),
      beforeEntryId,
      limit,
    );
    return {
      messages: this.applyMessageReadOverlays(result.messages, ref.sessionFile),
      hasOlder: result.hasOlder,
      totalMessageCount: result.totalMessageCount,
      olderMessageCount: result.olderMessageCount,
      olderUserMessageCount: result.olderUserMessageCount,
    };
  }

  private applyMessageReadOverlays(
    messages: ChatMessage[],
    sessionFile: string,
  ): ChatMessage[] {
    for (const message of messages) {
      if (message.role !== 'user' || !message.userMessageId || !message.turnRequest) {
        continue;
      }
      const paths = this.externalContexts.getTurnPaths(sessionFile, message.userMessageId);
      if (paths.length > 0) {
        message.turnRequest = { ...message.turnRequest, externalContextPaths: paths };
      }
    }
    const { skills } = loadRuntimeVaultSkills(this.vaultPath);
    return applySkillDescriptions(messages, skills);
  }

  getUsage(ref: SessionRef): Promise<UsageInfo | null> {
    const index = readSessionJsonlIndex(toAbsoluteSessionPath(this.vaultPath, ref.sessionFile));
    for (let i = index.entries.length - 1; i >= 0; i--) {
      const line = index.entries[i];
      if (line?.entryType !== 'message' || line.role !== 'assistant') continue;
      const entry = readSessionJsonlIndexedLine(index, line);
      const usage = usageInfoFromAssistantMessage(entry.message as AgentMessage | undefined);
      if (usage) {
        const estimates = estimateActiveContextCategories(index.entries.map(indexEntry =>
          readSessionJsonlIndexedLine(index, indexEntry) as unknown as SessionEntry));
        return Promise.resolve({
          ...usage,
          contextEnvelope: calculateContextEnvelope({
            checkpoints: estimates.checkpoints,
            contextWindow: usage.contextWindow,
            contextWindowIsAuthoritative: usage.contextWindowIsAuthoritative,
            outputTokenLimit: usage.outputTokenLimit,
            providerContextTokens: usage.contextTokensIsAuthoritative
              ? usage.contextTokens
              : undefined,
            recentConversation: estimates.recentConversation,
            toolAndAgentResults: estimates.toolAndAgentResults,
          }),
        });
      }
    }
    return Promise.resolve(null);
  }

  appendMessageUiPatches(ref: SessionRef, patches: MessageUiPatch[]): Promise<SessionRef> {
    const store = SessionTreeStore.open(
      this.vaultPath,
      ref.sessionFile,
    );
    const currentUiByEntryId = collectMessageUiMap(store.getEntries());
    for (const patch of patches) {
      const result = sanitizeMessageUiForJsonl(patch);
      if (result.externalContextPaths) {
        this.externalContexts.setTurnPaths(ref.sessionFile, patch.targetEntryId, result.externalContextPaths);
      }
      const sanitizedPatch = result.sanitized;
      const current = currentUiByEntryId.get(patch.targetEntryId) as MessageUiPatch | undefined;
      if (patchAlreadyPersisted(current, sanitizedPatch)) {
        continue;
      }
      store.appendMessageUi(sanitizedPatch);
      currentUiByEntryId.set(patch.targetEntryId, mergeMessageUiPatch(current, sanitizedPatch));
    }
    return Promise.resolve(this.refFromStore(store));
  }

  fork(ref: SessionRef, atEntryId: string): Promise<SessionRef> {
    const newFile = SessionTreeStore.forkFile(this.vaultPath, ref.sessionFile, atEntryId);
    if (!newFile) {
      throw new Error("Failed to fork session");
    }
    const forked = SessionTreeStore.open(this.vaultPath, newFile);
    const forkedRef = this.refFromStore(forked);
    this.externalContexts.copySession(ref.sessionFile, forkedRef.sessionFile);
    return Promise.resolve(forkedRef);
  }

  async deleteSession(sessionFile: string): Promise<void> {
    const relativePath = toVaultRelativePath(this.vaultPath, sessionFile);
    await this.adapter.delete(relativePath);
    invalidateSessionJsonlIndex(toAbsoluteSessionPath(this.vaultPath, relativePath));
    this.externalContexts.deleteSession(relativePath);
  }

  async trashSession(sessionFile: string): Promise<void> {
    const live = toVaultRelativePath(this.vaultPath, sessionFile);
    const trashed = toTrashedSessionFile(live);
    const liveExists = await this.adapter.exists(live);
    const trashExists = await this.adapter.exists(trashed);
    if (!liveExists) {
      if (trashExists) {
        return;
      }
      throw new Error(`Session file is missing: ${live}`);
    }
    if (trashExists) {
      await this.adapter.delete(trashed);
    }
    const parent = parentVaultRelativePath(trashed);
    if (parent) {
      await this.adapter.ensureFolder(parent);
    }
    await this.adapter.rename(live, trashed);
    const now = new Date();
    utimesSync(toAbsoluteSessionPath(this.vaultPath, trashed), now, now);
    invalidateSessionJsonlIndex(toAbsoluteSessionPath(this.vaultPath, live));
    invalidateSessionJsonlIndex(toAbsoluteSessionPath(this.vaultPath, trashed));
  }

  async listTrashedSessions(): Promise<Array<{ sessionFile: string; deletedAt: number }>> {
    const records: Array<{ sessionFile: string; deletedAt: number }> = [];
    for (const absoluteFile of listJsonlFilesUnder(getPiviSessionTrashRoot(this.vaultPath))) {
      try {
        const sessionFile = toLiveSessionFile(toVaultRelativePath(this.vaultPath, absoluteFile));
        records.push({
          sessionFile,
          deletedAt: statSync(absoluteFile).mtimeMs,
        });
      } catch {
        // Ignore malformed or concurrently removed trash files.
      }
    }
    return records.sort((left, right) => right.deletedAt - left.deletedAt);
  }

  async restoreTrashedSession(sessionFile: string): Promise<void> {
    const live = toVaultRelativePath(this.vaultPath, sessionFile);
    const trashed = toTrashedSessionFile(live);
    if (await this.adapter.exists(live)) {
      throw new Error(`Cannot restore over an existing session file: ${live}`);
    }
    if (!(await this.adapter.exists(trashed))) {
      throw new Error(`Deleted session file is missing: ${live}`);
    }
    const parent = parentVaultRelativePath(live);
    if (parent) {
      await this.adapter.ensureFolder(parent);
    }
    await this.adapter.rename(trashed, live);
    invalidateSessionJsonlIndex(toAbsoluteSessionPath(this.vaultPath, trashed));
    invalidateSessionJsonlIndex(toAbsoluteSessionPath(this.vaultPath, live));
  }

  async purgeTrashedSession(sessionFile: string): Promise<void> {
    const live = toVaultRelativePath(this.vaultPath, sessionFile);
    const trashed = toTrashedSessionFile(live);
    await this.adapter.delete(trashed);
    invalidateSessionJsonlIndex(toAbsoluteSessionPath(this.vaultPath, live));
    invalidateSessionJsonlIndex(toAbsoluteSessionPath(this.vaultPath, trashed));
    this.externalContexts.deleteSession(live);
  }

  readUiContext(ref: SessionRef): Promise<SessionUiContext> {
    const index = readSessionJsonlIndex(toAbsoluteSessionPath(this.vaultPath, ref.sessionFile));
    for (let i = index.entries.length - 1; i >= 0; i--) {
      const line = index.entries[i];
      if (line?.customType !== PIVI_UI_CONTEXT) continue;
      const entry = readSessionJsonlIndexedLine(index, line);
      const data = entry.data as PiviUiContextData | undefined;
      if (data) {
        return Promise.resolve({
          currentNote: data.currentNote,
          externalContextPaths: this.externalContexts.getSessionPaths(ref.sessionFile),
          enabledMcpServers: data.enabledMcpServers,
        });
      }
    }
    return Promise.resolve({
      externalContextPaths: this.externalContexts.getSessionPaths(ref.sessionFile),
    });
  }

  async writeUiContext(
    ref: SessionRef,
    patch: Partial<SessionUiContext>,
  ): Promise<void> {
    const store = SessionTreeStore.open(
      this.vaultPath,
      ref.sessionFile,
    );
    const entries = store.getEntries();
    let current: SessionUiContext = {
      externalContextPaths: this.externalContexts.getSessionPaths(ref.sessionFile),
    };
    for (let i = entries.length - 1; i >= 0; i--) {
      const entry = entries[i];
      if (entry?.type !== 'custom' || entry.customType !== PIVI_UI_CONTEXT) continue;
      const data = entry.data as PiviUiContextData | undefined;
      current = {
        currentNote: data?.currentNote,
        externalContextPaths: current.externalContextPaths,
        enabledMcpServers: data?.enabledMcpServers,
      };
      break;
    }
    if (patch.externalContextPaths !== undefined) {
      this.externalContexts.setSessionPaths(ref.sessionFile, patch.externalContextPaths);
    }
    const next = {
      currentNote: patch.currentNote ?? current.currentNote,
      enabledMcpServers: patch.enabledMcpServers ?? current.enabledMcpServers,
    };
    if (current.currentNote === next.currentNote
      && arraysEqual(current.enabledMcpServers, next.enabledMcpServers)) {
      return;
    }
    store.appendUiContext(next);
  }

  writeSessionMeta(ref: SessionRef, patch: SessionMetaPatch): Promise<void> {
    const store = SessionTreeStore.open(
      this.vaultPath,
      ref.sessionFile,
    );
    const existing = readSessionMetaFromBranch(store.getEntries());
    const next: PiviSessionMetaData = {
      title: patch.title ?? existing?.title ?? "New session",
      titleSource: patch.titleSource ?? existing?.titleSource,
      createdAt: patch.createdAt ?? existing?.createdAt ?? Date.now(),
      lastResponseAt: patch.lastResponseAt ?? existing?.lastResponseAt,
    };
    if (sessionMetaEqual(existing, next)) {
      return Promise.resolve();
    }
    store.appendCustomMeta(next);
    return Promise.resolve();
  }
}

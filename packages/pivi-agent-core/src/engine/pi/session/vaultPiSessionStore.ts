import type { AgentMessage } from '@earendil-works/pi-agent-core';
import type { SessionEntry } from '@earendil-works/pi-coding-agent';

import type { ChatMessage } from '../../../foundation';
import { sanitizeMessageUiForJsonl } from '../../../session/messageUi';
import type {
  DeviceLocalExternalContextStore,
  MessageUiPatch,
  PersistedAgentMessage,
  PiviSessionMetaData,
  PiviUiContextData,
  SessionMessagePage,
  SessionMetaPatch,
  SessionRef,
  SessionStore,
  SessionUiContext,
  StoreSessionInfo,
  UserTurnUi,
} from '../../../session/types';
import {
  PIVI_SESSION_DELETED,
  PIVI_UI_CONTEXT,
  SessionRangeCursorError,
} from '../../../session/types';
import { requireVaultSessionPath } from '../../../session/vaultSessionPaths';
import {
  ExternalContextJsonlMigrationError,
  stripExternalContextsFromSessionJsonl,
} from './externalContextJsonl';
import {
  collectMessageUiMap,
  entriesToChatMessages,
  firstUserMessagePreview,
  readSessionMetaFromBranch,
} from './mobileMessageMapper';
import type { PiSessionTree } from './piSessionTree';
import {
  type SessionJsonlStorage,
  SessionRevisionError,
  SessionWriteUncertainError,
} from './sessionJsonlStorage';
import type { VaultPiSessionTree, VaultPiSessionTreeFactory } from './vaultPiSessionTree';

export interface VaultPiSessionStoreLogger {
  warn(message: string, error?: unknown): void;
}

export interface VaultPiSessionStoreOptions {
  externalContexts?: DeviceLocalExternalContextStore;
  logger?: VaultPiSessionStoreLogger;
  /** Optional Mobile-safe presentation overlay (for example, skill descriptions). */
  projectMessages?: (messages: ChatMessage[]) => ChatMessage[] | Promise<ChatMessage[]>;
  now?: () => number;
}

class MemoryExternalContexts implements DeviceLocalExternalContextStore {
  private readonly values = new Map<string, { session: string[]; turns: Map<string, string[]> }>();
  private get(file: string) {
    let value = this.values.get(file);
    if (!value) { value = { session: [], turns: new Map() }; this.values.set(file, value); }
    return value;
  }
  getSessionPaths(file: string): string[] { return [...this.get(file).session]; }
  setSessionPaths(file: string, paths: readonly string[]): void { this.get(file).session = [...paths]; }
  getTurnPaths(file: string, id: string): string[] { return [...(this.get(file).turns.get(id) ?? [])]; }
  setTurnPaths(file: string, id: string, paths: readonly string[]): void { this.get(file).turns.set(id, [...paths]); }
  copySession(source: string, target: string): void {
    const value = this.get(source);
    this.values.set(target, { session: [...value.session], turns: new Map(
      [...value.turns].map(([id, paths]) => [id, [...paths]]),
    ) });
  }
  deleteSession(file: string): void { this.values.delete(file); }
}

function positiveLimit(limit: number): number {
  if (!Number.isSafeInteger(limit) || limit <= 0) {
    throw new RangeError('Session message page limit must be a positive safe integer');
  }
  return limit;
}

function arraysEqual(left?: readonly string[], right?: readonly string[]): boolean {
  return left === right || (!!left && !!right && left.length === right.length
    && left.every((value, index) => value === right[index]));
}

function stableJson(value: unknown): string {
  if (value === undefined) return 'undefined';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(',')}}`;
}

function isDeletedEntries(entries: readonly SessionEntry[]): boolean {
  return entries.some(entry => (
    entry.type === 'custom' && entry.customType === PIVI_SESSION_DELETED
  ));
}

function isDeleted(tree: PiSessionTree): boolean {
  if (typeof (tree as VaultPiSessionTree).isTombstoned === 'function') {
    return (tree as VaultPiSessionTree).isTombstoned();
  }
  return isDeletedEntries(tree.getEntries());
}

function patchPersisted(current: MessageUiPatch | undefined, patch: MessageUiPatch): boolean {
  const keys = Object.keys(patch).filter(key => key !== 'targetEntryId') as Array<keyof MessageUiPatch>;
  return keys.length === 0 || (!!current && keys.every(key => stableJson(current[key]) === stableJson(patch[key])));
}

/** Entry IDs present on the fork branch (represented overlays only). */
function representedEntryIds(tree: PiSessionTree): ReadonlySet<string> {
  return new Set(tree.getEntries().map(entry => entry.id));
}

export class VaultPiSessionStore implements SessionStore {
  private readonly externalContexts: DeviceLocalExternalContextStore;
  private readonly logger: VaultPiSessionStoreLogger;
  private readonly projectMessages: (messages: ChatMessage[]) => ChatMessage[] | Promise<ChatMessage[]>;
  private readonly now: () => number;
  /** Single-flight external-context migration; one Promise<boolean> shared by batch and open. */
  private readonly migrations = new Map<string, Promise<boolean>>();
  /** Per-session queue covering JSONL mutations and external-context overlay effects. */
  private readonly operationQueues = new Map<string, Promise<void>>();
  /** Paths whose overlays were deliberately cleared (tombstone); reject concurrent resurrection. */
  private readonly deletedOverlays = new Set<string>();

  constructor(
    private readonly storage: SessionJsonlStorage,
    private readonly trees: VaultPiSessionTreeFactory,
    options: VaultPiSessionStoreOptions = {},
  ) {
    this.externalContexts = options.externalContexts ?? new MemoryExternalContexts();
    this.logger = options.logger ?? { warn: () => undefined };
    this.projectMessages = options.projectMessages ?? (messages => messages);
    this.now = options.now ?? Date.now;
  }

  sessionRefFromOpenSession(open: { sessionFile?: string; sessionId?: string | null; id: string }): SessionRef | null {
    return open.sessionFile ? {
      sessionFile: requireVaultSessionPath(open.sessionFile),
      sessionId: open.sessionId ?? open.id,
    } : null;
  }

  private ref(tree: PiSessionTree): SessionRef {
    return { sessionFile: requireVaultSessionPath(tree.getSessionFile()), sessionId: tree.getSessionId() };
  }

  private async runQueued<T>(path: string, operation: () => Promise<T>): Promise<T> {
    const key = requireVaultSessionPath(path);
    const previous = this.operationQueues.get(key) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const chained = previous.catch(() => undefined).then(() => gate);
    this.operationQueues.set(key, chained);
    await previous.catch(() => undefined);
    try {
      return await operation();
    } finally {
      release();
      if (this.operationQueues.get(key) === chained) this.operationQueues.delete(key);
    }
  }

  private setSessionOverlay(path: string, paths: readonly string[]): void {
    if (this.deletedOverlays.has(path)) return;
    this.externalContexts.setSessionPaths(path, paths);
  }

  private setTurnOverlay(path: string, entryId: string, paths: readonly string[]): void {
    if (this.deletedOverlays.has(path)) return;
    this.externalContexts.setTurnPaths(path, entryId, paths);
  }

  private clearOverlay(path: string): void {
    this.deletedOverlays.add(path);
    this.externalContexts.deleteSession(path);
  }

  /** Snapshot device-local turn overlay for one entry so definite write failures can restore it. */
  private captureTurnOverlay(path: string, entryId: string): string[] {
    return this.externalContexts.getTurnPaths(path, entryId);
  }

  /** Snapshot device-local session overlay so definite write failures can restore it. */
  private captureSessionOverlay(path: string): string[] {
    return this.externalContexts.getSessionPaths(path);
  }

  /**
   * Publish turn overlay first; restore prior on definite failure; retain on uncertain.
   * Uncertain means the durable write may have landed, so the new overlay is the safer cache.
   */
  private async publishTurnOverlayThen(
    path: string,
    entryId: string,
    nextPaths: readonly string[] | undefined,
    write: () => Promise<void>,
  ): Promise<void> {
    if (nextPaths === undefined) {
      await write();
      return;
    }
    const prior = this.captureTurnOverlay(path, entryId);
    this.setTurnOverlay(path, entryId, nextPaths);
    try {
      await write();
    } catch (error) {
      if (!(error instanceof SessionWriteUncertainError)) {
        this.setTurnOverlay(path, entryId, prior);
      }
      throw error;
    }
  }

  /**
   * Publish session overlay first; restore prior on definite failure; retain on uncertain.
   */
  private async publishSessionOverlayThen(
    path: string,
    nextPaths: readonly string[] | undefined,
    write: () => Promise<void>,
  ): Promise<void> {
    if (nextPaths === undefined) {
      await write();
      return;
    }
    const prior = this.captureSessionOverlay(path);
    this.setSessionOverlay(path, nextPaths);
    try {
      await write();
    } catch (error) {
      if (!(error instanceof SessionWriteUncertainError)) {
        this.setSessionOverlay(path, prior);
      }
      throw error;
    }
  }

  /**
   * Snapshot every overlay key that migration will stage, so a divergent replacement can roll back
   * without contaminating an unrelated session that reused the path.
   */
  private captureMigrationOverlay(
    path: string,
    migration: { sessionPaths?: string[]; turnPaths: Map<string, string[]> },
  ): { session: string[] | undefined; turns: Map<string, string[]> } {
    return {
      session: migration.sessionPaths !== undefined ? this.captureSessionOverlay(path) : undefined,
      turns: new Map(
        [...migration.turnPaths.keys()].map(entryId => [entryId, this.captureTurnOverlay(path, entryId)]),
      ),
    };
  }

  private restoreMigrationOverlay(
    path: string,
    prior: { session: string[] | undefined; turns: Map<string, string[]> },
  ): void {
    if (prior.session !== undefined) this.setSessionOverlay(path, prior.session);
    for (const [entryId, paths] of prior.turns) this.setTurnOverlay(path, entryId, paths);
  }

  private stageMigrationOverlay(
    path: string,
    migration: { sessionPaths?: string[]; turnPaths: Map<string, string[]> },
  ): void {
    if (migration.sessionPaths !== undefined) {
      this.setSessionOverlay(path, migration.sessionPaths);
    }
    for (const [entryId, paths] of migration.turnPaths) {
      this.setTurnOverlay(path, entryId, paths);
    }
  }

  /** Session id from a JSONL header line, or null when the file is empty/unparseable. */
  private sessionIdFromContent(content: string): string | null {
    const first = content.split('\n').find(line => line.trim());
    if (!first) return null;
    try {
      const value: unknown = JSON.parse(first);
      if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
      const id = (value as { type?: unknown; id?: unknown }).type === 'session'
        ? (value as { id?: unknown }).id
        : undefined;
      return typeof id === 'string' ? id : null;
    } catch {
      return null;
    }
  }

  /**
   * Overlay-first external-context migration with uncertain-replace reconciliation.
   * Shared single-flight Promise<boolean> for batch startup and lazy open.
   */
  private migrateFile(path: string): Promise<boolean> {
    const existing = this.migrations.get(path);
    if (existing) return existing;
    const migration = this.performMigration(path).finally(() => {
      if (this.migrations.get(path) === migration) this.migrations.delete(path);
    });
    this.migrations.set(path, migration);
    return migration;
  }

  private async performMigration(path: string): Promise<boolean> {
    const snapshot = await this.storage.read(path);
    const migration = stripExternalContextsFromSessionJsonl(snapshot.content, snapshot.path);
    if (!migration.changed) return false;

    // Overlay-first: capture prior, stage extracted paths, then rewrite synced JSONL.
    // A crash after replace must not leave absolute paths only in the stripped file.
    const prior = this.captureMigrationOverlay(snapshot.path, migration);
    this.stageMigrationOverlay(snapshot.path, migration);

    try {
      await this.storage.replace(snapshot.path, migration.content, snapshot.revision);
    } catch (error) {
      if (error instanceof SessionRevisionError || error instanceof SessionWriteUncertainError) {
        return this.reconcileUncertainMigration(
          snapshot.path,
          migration.content,
          snapshot.content,
          prior,
        );
      }
      this.restoreMigrationOverlay(snapshot.path, prior);
      throw error;
    }
    return true;
  }

  /**
   * Distinguish exact target (success), exact original source (retry strip), and divergent
   * bytes/session ID (conflict: roll back staged overlay so it cannot contaminate a replacement).
   */
  private async reconcileUncertainMigration(
    path: string,
    expectedContent: string,
    originalSourceContent: string,
    prior: { session: string[] | undefined; turns: Map<string, string[]> },
    sourceRetried = false,
  ): Promise<boolean> {
    const landed = await this.storage.read(path);

    // Exact target: our stripped bytes landed (or a concurrent writer produced identical output).
    if (landed.content === expectedContent) return true;

    // Exact original source: replace did not land; retry strip once from the same bytes.
    if (landed.content === originalSourceContent) {
      if (sourceRetried) {
        this.restoreMigrationOverlay(path, prior);
        throw new SessionRevisionError(path);
      }
      const again = stripExternalContextsFromSessionJsonl(landed.content, path);
      if (!again.changed) {
        this.restoreMigrationOverlay(path, prior);
        return false;
      }
      // Keep/re-stage overlays extracted from the same source (idempotent with the first stage).
      this.stageMigrationOverlay(path, again);
      try {
        await this.storage.replace(path, again.content, landed.revision);
        return true;
      } catch (error) {
        if (error instanceof SessionRevisionError || error instanceof SessionWriteUncertainError) {
          return this.reconcileUncertainMigration(
            path, again.content, originalSourceContent, prior, true,
          );
        }
        this.restoreMigrationOverlay(path, prior);
        throw error;
      }
    }

    // Divergent bytes: another writer replaced the file. Same session id may still need strip;
    // a different session id must not keep overlays staged from the old session.
    const expectedSessionId = this.sessionIdFromContent(originalSourceContent);
    const landedSessionId = this.sessionIdFromContent(landed.content);
    const sameSession = expectedSessionId !== null
      && landedSessionId !== null
      && expectedSessionId === landedSessionId;

    if (!sameSession) {
      this.restoreMigrationOverlay(path, prior);
      throw new SessionRevisionError(path);
    }

    // Same session, different bytes: drop stale staged overlay, strip current content if needed.
    this.restoreMigrationOverlay(path, prior);
    const current = stripExternalContextsFromSessionJsonl(landed.content, path);
    if (!current.changed) return true;
    const currentPrior = this.captureMigrationOverlay(path, current);
    this.stageMigrationOverlay(path, current);
    try {
      await this.storage.replace(path, current.content, landed.revision);
      return true;
    } catch (error) {
      if (error instanceof SessionRevisionError || error instanceof SessionWriteUncertainError) {
        const final = await this.storage.read(path);
        if (final.content === current.content) return true;
        const finalStrip = stripExternalContextsFromSessionJsonl(final.content, path);
        if (!finalStrip.changed) {
          this.restoreMigrationOverlay(path, currentPrior);
          return true;
        }
        const finalSessionId = this.sessionIdFromContent(final.content);
        if (expectedSessionId !== null && finalSessionId !== null && finalSessionId !== expectedSessionId) {
          this.restoreMigrationOverlay(path, currentPrior);
          throw new SessionRevisionError(path);
        }
        throw error;
      }
      this.restoreMigrationOverlay(path, currentPrior);
      throw error;
    }
  }

  async migrateDeviceLocalExternalContexts(): Promise<number> {
    let count = 0;
    for (const entry of await this.storage.list()) {
      try {
        if (await this.migrateFile(entry.path)) count++;
      } catch (error) {
        if (!(error instanceof ExternalContextJsonlMigrationError)) throw error;
        this.logger.warn(error.message, error);
      }
    }
    return count;
  }

  private async openTree(path: string, allowDeleted = false): Promise<PiSessionTree> {
    const validPath = requireVaultSessionPath(path);
    try {
      await this.migrateFile(validPath);
      const tree = await this.trees.open(validPath);
      if (!allowDeleted && isDeleted(tree)) throw new Error('Session is deleted');
      return tree;
    } catch (error) {
      throw new Error(
        `Failed to open session ${validPath}: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
  }

  async listSessions(_vaultPath: string): Promise<StoreSessionInfo[]> {
    const summaries: StoreSessionInfo[] = [];
    for (const catalog of await this.storage.list()) {
      try {
        const tree = await this.openTree(catalog.path, true);
        if (isDeleted(tree)) continue;
        const entries = [...tree.getLinearVisiblePrefix()];
        const allEntries = [...tree.getEntries()];
        const meta = readSessionMetaFromBranch(allEntries);
        const preview = firstUserMessagePreview(entries);
        const messages = entriesToChatMessages(entries, collectMessageUiMap(entries));
        summaries.push({
          sessionFile: requireVaultSessionPath(catalog.path), sessionId: tree.getSessionId(),
          title: meta?.title || preview,
          ...(meta?.titleSource ? { titleSource: meta.titleSource } : {}),
          updatedAt: meta?.lastResponseAt ?? catalog.stat?.mtime ?? (Date.parse(allEntries.at(-1)?.timestamp
            ?? allEntries.at(0)?.timestamp ?? '') || 0),
          leafCount: 1, messagePreview: preview, messageCount: messages.length,
        });
      } catch (error) {
        this.logger.warn(`Skipped malformed session ${catalog.path}`, error);
      }
    }
    return summaries.sort((left, right) => right.updatedAt - left.updatedAt);
  }

  async create(_vaultPath: string): Promise<SessionRef> {
    return this.ref(await this.trees.create());
  }

  async open(sessionFile: string): Promise<SessionRef> { return this.ref(await this.openTree(sessionFile)); }

  private async projected(ref: SessionRef): Promise<ChatMessage[]> {
    const tree = await this.openTree(ref.sessionFile);
    const entries = [...tree.getLinearVisiblePrefix()];
    const messages = entriesToChatMessages(entries, collectMessageUiMap([...tree.getEntries()]));
    for (const message of messages) {
      if (message.role !== 'user' || !message.userMessageId || !message.turnRequest) continue;
      const paths = this.externalContexts.getTurnPaths(ref.sessionFile, message.userMessageId);
      if (paths.length) message.turnRequest = { ...message.turnRequest, externalContextPaths: paths };
    }
    return this.projectMessages(messages);
  }

  getMessages(ref: SessionRef): Promise<ChatMessage[]> { return this.projected(ref); }

  private page(messages: ChatMessage[], start: number, end: number): SessionMessagePage {
    const safeStart = start > 0 && messages[start]?.role === 'assistant' && messages[start - 1]?.role === 'user'
      ? start - 1 : start;
    return {
      messages: messages.slice(safeStart, end), hasOlder: safeStart > 0,
      totalMessageCount: messages.length, olderMessageCount: safeStart,
      olderUserMessageCount: messages.slice(0, safeStart).filter(message => message.role === 'user').length,
    };
  }

  async openRecent(ref: SessionRef, limit: number): Promise<SessionMessagePage> {
    const messages = await this.projected(ref); const size = positiveLimit(limit);
    const start = Math.max(0, messages.length - size);
    return this.page(messages, start, Math.min(messages.length, start + size));
  }

  async readOlder(ref: SessionRef, beforeEntryId: string, limit: number): Promise<SessionMessagePage> {
    const messages = await this.projected(ref);
    const before = messages.findIndex(message => message.id === beforeEntryId);
    if (before < 0) throw new SessionRangeCursorError(
      `Session message cursor ${beforeEntryId} was not found`, ref.sessionFile, beforeEntryId,
    );
    const start = Math.max(0, before - positiveLimit(limit));
    return this.page(messages, start, before);
  }

  async appendUserTurn(ref: SessionRef, prompt: string, ui?: UserTurnUi): Promise<SessionRef> {
    return this.runQueued(ref.sessionFile, async () => {
      const tree = await this.openTree(ref.sessionFile);
      const result = ui ? sanitizeMessageUiForJsonl(ui) : undefined;
      const persistedUi = result?.sanitized.displayContent || result?.sanitized.turnRequest
        ? result.sanitized : undefined;
      const entryId = await tree.appendUserTurn(prompt, ui?.images, persistedUi);
      if (result?.externalContextPaths) {
        this.setTurnOverlay(ref.sessionFile, entryId, result.externalContextPaths);
      }
      return this.ref(tree);
    });
  }

  async appendAgentTurn(ref: SessionRef, messages: PersistedAgentMessage[], ui?: MessageUiPatch[]): Promise<SessionRef> {
    return this.runQueued(ref.sessionFile, async () => {
      const tree = await this.openTree(ref.sessionFile);
      await tree.syncAgentMessages(messages as unknown as AgentMessage[]);
      for (const patch of ui ?? []) await this.appendPatch(tree, ref.sessionFile, patch);
      return this.ref(tree);
    });
  }

  private async appendPatch(tree: PiSessionTree, file: string, patch: MessageUiPatch): Promise<void> {
    const result = sanitizeMessageUiForJsonl(patch);
    await this.publishTurnOverlayThen(
      file,
      patch.targetEntryId,
      result.externalContextPaths,
      async () => { await tree.appendMessageUi(result.sanitized); },
    );
  }

  async appendMessageUiPatches(ref: SessionRef, patches: MessageUiPatch[]): Promise<SessionRef> {
    return this.runQueued(ref.sessionFile, async () => {
      const tree = await this.openTree(ref.sessionFile);
      const current = collectMessageUiMap([...tree.getEntries()]);
      for (const patch of patches) {
        const result = sanitizeMessageUiForJsonl(patch);
        const existing = current.get(patch.targetEntryId) as MessageUiPatch | undefined;
        if (patchPersisted(existing, result.sanitized)) {
          // Idempotent UI fields still publish a fresher device-local overlay when provided.
          if (result.externalContextPaths) {
            this.setTurnOverlay(ref.sessionFile, patch.targetEntryId, result.externalContextPaths);
          }
          continue;
        }
        await this.publishTurnOverlayThen(
          ref.sessionFile,
          patch.targetEntryId,
          result.externalContextPaths,
          async () => { await tree.appendMessageUi(result.sanitized); },
        );
        current.set(patch.targetEntryId, { ...existing, ...result.sanitized });
      }
      return this.ref(tree);
    });
  }

  async fork(ref: SessionRef, atEntryId: string): Promise<SessionRef> {
    return this.runQueued(ref.sessionFile, async () => {
      const source = await this.openTree(ref.sessionFile);
      const forked = await source.forkToNewTree(atEntryId);
      if (!forked) throw new Error('Failed to fork session');
      const result = this.ref(forked);
      // Copy only overlays represented on the forked branch (entry IDs present in the new tree).
      const ids = representedEntryIds(forked);
      const sessionPaths = this.externalContexts.getSessionPaths(ref.sessionFile);
      if (sessionPaths.length) this.setSessionOverlay(result.sessionFile, sessionPaths);
      for (const id of ids) {
        const turnPaths = this.externalContexts.getTurnPaths(ref.sessionFile, id);
        if (turnPaths.length) this.setTurnOverlay(result.sessionFile, id, turnPaths);
      }
      return result;
    });
  }

  /**
   * Append-only tombstone. On uncertain write, reread; if the tombstone landed, run
   * idempotent cleanup. Concurrent overlay writes cannot resurrect a cleared overlay.
   */
  async deleteSession(sessionFile: string): Promise<void> {
    const path = requireVaultSessionPath(sessionFile);
    await this.runQueued(path, async () => {
      const tree = await this.openTree(path, true);
      if (isDeleted(tree)) {
        this.finishTombstoneCleanup(path);
        return;
      }
      if (!tree.appendSessionDeleted) throw new Error('Session store does not support atomic deletion');
      try {
        await tree.appendSessionDeleted(this.now());
      } catch (error) {
        if (error instanceof SessionWriteUncertainError || error instanceof SessionRevisionError) {
          await this.reconcileUncertainTombstone(path);
          return;
        }
        throw error;
      }
      this.finishTombstoneCleanup(path);
    });
  }

  private finishTombstoneCleanup(path: string): void {
    this.trees.forget(path);
    this.clearOverlay(path);
  }

  private async reconcileUncertainTombstone(path: string): Promise<void> {
    this.trees.forget(path);
    const snapshot = await this.storage.read(path);
    // Detect tombstone from durable bytes (not a possibly-invalidated live tree).
    const hasTombstone = snapshot.content.split('\n').some(line => {
      if (!line.trim()) return false;
      try {
        const value: unknown = JSON.parse(line);
        return !!value && typeof value === 'object' && !Array.isArray(value)
          && (value as { type?: unknown }).type === 'custom'
          && (value as { customType?: unknown }).customType === PIVI_SESSION_DELETED;
      } catch {
        return false;
      }
    });
    if (hasTombstone) {
      this.finishTombstoneCleanup(path);
      return;
    }
    // Tombstone did not land; surface the uncertain failure by requiring a fresh open path.
    throw new SessionWriteUncertainError(path);
  }

  async readUiContext(ref: SessionRef): Promise<SessionUiContext> {
    const tree = await this.openTree(ref.sessionFile);
    const entry = [...tree.getEntries()].reverse().find(value => value.type === 'custom'
      && value.customType === PIVI_UI_CONTEXT);
    const data = entry?.type === 'custom' ? entry.data as PiviUiContextData | undefined : undefined;
    return { currentNote: data?.currentNote, enabledMcpServers: data?.enabledMcpServers,
      externalContextPaths: this.externalContexts.getSessionPaths(ref.sessionFile) };
  }

  async writeUiContext(ref: SessionRef, patch: Partial<SessionUiContext>): Promise<void> {
    await this.runQueued(ref.sessionFile, async () => {
      const tree = await this.openTree(ref.sessionFile);
      const current = await this.readUiContextUnlocked(tree, ref.sessionFile);
      const next = { currentNote: patch.currentNote ?? current.currentNote,
        enabledMcpServers: patch.enabledMcpServers ?? current.enabledMcpServers };
      const durableUnchanged = next.currentNote === current.currentNote
        && arraysEqual(next.enabledMcpServers, current.enabledMcpServers);
      if (durableUnchanged) {
        // Overlay-only update: no JSONL write to fail, so publish immediately.
        if (patch.externalContextPaths !== undefined) {
          this.setSessionOverlay(ref.sessionFile, patch.externalContextPaths);
        }
        return;
      }
      await this.publishSessionOverlayThen(
        ref.sessionFile,
        patch.externalContextPaths,
        async () => { await tree.appendUiContext(next); },
      );
    });
  }

  private async readUiContextUnlocked(tree: PiSessionTree, sessionFile: string): Promise<SessionUiContext> {
    const entry = [...tree.getEntries()].reverse().find(value => value.type === 'custom'
      && value.customType === PIVI_UI_CONTEXT);
    const data = entry?.type === 'custom' ? entry.data as PiviUiContextData | undefined : undefined;
    return { currentNote: data?.currentNote, enabledMcpServers: data?.enabledMcpServers,
      externalContextPaths: this.externalContexts.getSessionPaths(sessionFile) };
  }

  async writeSessionMeta(ref: SessionRef, patch: SessionMetaPatch): Promise<void> {
    await this.runQueued(ref.sessionFile, async () => {
      const tree = await this.openTree(ref.sessionFile);
      const existing = readSessionMetaFromBranch([...tree.getEntries()]);
      const next: PiviSessionMetaData = { title: patch.title ?? existing?.title ?? 'New session',
        titleSource: patch.titleSource ?? existing?.titleSource,
        createdAt: patch.createdAt ?? existing?.createdAt ?? this.now(),
        lastResponseAt: patch.lastResponseAt ?? existing?.lastResponseAt };
      if (existing && stableJson(existing) === stableJson(next)) return;
      await tree.appendCustomMeta(next);
    });
  }
}

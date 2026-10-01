import type { AgentMessage } from '@earendil-works/pi-agent-core';
import type {
  ImageContent,
  TextContent,
} from '@earendil-works/pi-ai';
import {
  buildContextEntries,
  buildSessionContext,
  type SessionEntry,
  SessionManager,
} from '@earendil-works/pi-coding-agent';
import { PluginLogger } from '@pivi/agent/logging/pluginLogger';
import type { ImageAttachment } from '@pivi/agent/runtime';
import {
  type Checkpoint,
  parsePiviCompactionDetails,
  type PiviCompactionDetails,
} from '@pivi/agent/session/continuationSchemas';
import { sanitizeMessageUiForJsonl } from '@pivi/agent/session/messageUi';
import {
  createJournalEntryId,
  SessionJournalBoundsError,
  type SessionJournalEntryV1,
  type SessionJournalIntent,
  upsertJournalEntry,
} from '@pivi/agent/session/sessionJournal';
import {
  getPiviSessionDir,
  toAbsoluteSessionPath,
  toVaultRelativePath,
} from '@pivi/agent/session/sessionPaths';
import {
  PIVI_COMPACTION_BOUNDARY,
  PIVI_MESSAGE_UI,
  PIVI_SESSION_META,
  PIVI_UI_CONTEXT,
  type PiviMessageUiData,
  type PiviSessionMetaData,
  type PiviUiContextData,
  SessionIndexStaleError,
} from '@pivi/agent/session/types';

import { toPiImageContent } from '../runtime/piImageContent';
import {
  missingAgentMessages,
  type MissingAgentMessagesOptions,
  sanitizeAgentMessagesForLlm,
} from './agentMessageHistory';
import {
  rewritePersistedSessionManager,
  truncatePersistedSessionManager,
} from './piSessionManagerPrivateAdapter';
import {
  assertSessionJsonlSourceUnchanged,
  captureSessionJsonlSource,
  invalidateSessionJsonlIndex,
  refreshSessionJsonlIndexAfterAppend,
  type SessionJsonlSourceFingerprint,
} from './sessionJsonlIndex';
import {
  applyPersistedAsyncSubagentResults,
  cacheKey,
  createBranchedSessionWithCompensation,
  getBoundJournalBinding,
  isLlmContextEntry,
  requireVaultSessionFile,
  sealAppendedContinuation,
} from './sessionTreeStoreSupport';
import { findLastVisibleConversationEntryId } from './visibleSessionEntries';
export {
  bindSessionJournal,
  getBoundSessionJournal,
  type SessionJournalBinding,
} from './sessionTreeStoreSupport';

const logger = new PluginLogger('SessionTreeStore');

export class SessionTreeStore {
  private static readonly liveByKey = new Map<string, SessionTreeStore>();

  private manager: SessionManager;
  private sourceFingerprint?: SessionJsonlSourceFingerprint;

  private constructor(
    private readonly vaultPath: string,
    manager: SessionManager,
  ) {
    this.manager = manager;
  }

  private registerLive(): void {
    const sessionFile = this.getVaultRelativeSessionFile();
    if (sessionFile) {
      SessionTreeStore.liveByKey.set(cacheKey(this.vaultPath, sessionFile), this);
    }
  }

  private persistentSessionFile(): string | undefined {
    if (!this.manager.isPersisted()) {
      return undefined;
    }
    return this.manager.getSessionFile();
  }

  private captureSourceFingerprint(): void {
    const sessionFile = this.persistentSessionFile();
    this.sourceFingerprint = sessionFile
      ? captureSessionJsonlSource(sessionFile)
      : undefined;
  }

  private assertWritableSource(): void {
    const sessionFile = this.persistentSessionFile();
    if (!sessionFile) {
      return;
    }
    try {
      if (!this.sourceFingerprint) {
        throw new SessionIndexStaleError('Live session has no source fingerprint', sessionFile);
      }
      assertSessionJsonlSourceUnchanged(sessionFile, this.sourceFingerprint);
    } catch (error) {
      this.evictLive();
      throw error;
    }
  }

  private evictLive(): void {
    const relative = this.getVaultRelativeSessionFile();
    if (relative) {
      SessionTreeStore.liveByKey.delete(cacheKey(this.vaultPath, relative));
    }
  }

  private refreshIndexAfterAppend(
    entryIds: readonly string[],
    journalEntry?: SessionJournalEntryV1,
  ): void {
    const sessionFile = this.persistentSessionFile();
    if (!sessionFile || !this.sourceFingerprint) {
      return;
    }
    const baseFingerprint = this.sourceFingerprint;
    const relative = this.getVaultRelativeSessionFile();
    try {
      this.sourceFingerprint = refreshSessionJsonlIndexAfterAppend(
        sessionFile,
        this.sourceFingerprint,
        entryIds,
      );
      this.recordAndAckJournal(sessionFile, relative, baseFingerprint, entryIds, journalEntry);
    } catch (error) {
      this.evictLive();
      throw error;
    }
  }

  /**
   * After a successful JSONL append, seal the continuation into the device-local
   * journal and mark it confirmed. Confirmed rows remain a bounded fingerprint
   * chain so a later synced rollback can recover exactly the local epoch.
   */
  private recordAndAckJournal(
    absoluteSessionFile: string,
    relativeSessionFile: string | null,
    baseFingerprint: SessionJsonlSourceFingerprint,
    entryIds: readonly string[],
    journalEntry?: SessionJournalEntryV1,
  ): void {
    const journal = getBoundJournalBinding();
    if (!journal || !relativeSessionFile || !this.sourceFingerprint) {
      return;
    }
    try {
      sealAppendedContinuation(journal, {
        absoluteSessionFile,
        relativeSessionFile,
        baseFingerprint,
        resultFingerprint: this.sourceFingerprint,
        entryIds,
        journalEntry,
      });
    } catch (error) {
      logger.warn('Failed to confirm session journal after append', {
        sessionFile: relativeSessionFile,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private persistJournalIntent(intent: SessionJournalIntent): SessionJournalEntryV1 | undefined {
    const relative = this.getVaultRelativeSessionFile();
    const journal = getBoundJournalBinding();
    if (!journal || !relative || !this.sourceFingerprint) {
      return undefined;
    }
    const createdAt = journal.now();
    const entry: SessionJournalEntryV1 = {
      version: 1,
      id: createJournalEntryId(relative, this.sourceFingerprint, intent, createdAt),
      sessionFile: relative,
      createdAt,
      status: 'intent',
      baseFingerprint: this.sourceFingerprint,
      intent,
    };
    try {
      journal.store.save(upsertJournalEntry(journal.store.load(), entry));
    } catch (error) {
      // The journal is a recovery aid, not the authoritative write path. A
      // journal codec/storage failure must never prevent the Pi JSONL append.
      logger.warn(
        error instanceof SessionJournalBoundsError
          ? 'Session journal intent exceeds the recovery bound'
          : 'Failed to persist session journal intent',
        {
          sessionFile: relative,
          error: error instanceof Error ? error.message : String(error),
        },
      );
      return undefined;
    }
    return entry;
  }

  /** Rewrite the authoritative file after a non-append mutation. */
  private rewriteToDisk(): void {
    if (!this.manager.isPersisted()) {
      return;
    }
    // Pi normally creates the file lazily on the first assistant message. Since
    // Pivi flushes earlier so history rows exist immediately, keep Pi's lazy
    // writer state in sync or the next append tries to create an existing file.
    rewritePersistedSessionManager(this.manager);
    const sessionFile = this.manager.getSessionFile();
    if (sessionFile) {
      invalidateSessionJsonlIndex(sessionFile);
      this.captureSourceFingerprint();
    }
  }

  static create(vaultPath: string): SessionTreeStore {
    if (vaultPath.startsWith('/test/') || process.env.NODE_ENV === 'test') {
      const store = SessionTreeStore.inMemory(vaultPath);
      store.registerLive();
      return store;
    }
    const sessionDir = getPiviSessionDir(vaultPath);
    const manager = SessionManager.create(vaultPath, sessionDir);
    const store = new SessionTreeStore(vaultPath, manager);
    // Pi normally creates the file on the first assistant response. Pivi needs
    // the session header to exist immediately; after this one bootstrap rewrite,
    // Pi's public append methods extend the file without rewriting prior bytes.
    store.rewriteToDisk();
    store.registerLive();
    return store;
  }

  static open(vaultPath: string, sessionFile: string, leafId?: string | null): SessionTreeStore {
    const cached = SessionTreeStore.liveByKey.get(cacheKey(vaultPath, sessionFile));
    if (cached) {
      cached.assertWritableSource();
      cached.applyLeafId(leafId);
      return cached;
    }

    if (vaultPath.startsWith('/test/') || process.env.NODE_ENV === 'test') {
      const store = SessionTreeStore.inMemory(vaultPath);
      store.applyLeafId(leafId);
      return store;
    }

    requireVaultSessionFile(sessionFile);
    const absolute = toAbsoluteSessionPath(vaultPath, sessionFile);
    const sessionDir = getPiviSessionDir(vaultPath);
    const manager = SessionManager.open(absolute, sessionDir, vaultPath);
    const store = new SessionTreeStore(vaultPath, manager);
    store.captureSourceFingerprint();
    store.applyLeafId(leafId);
    store.registerLive();
    return store;
  }

  static openSnapshot(vaultPath: string, sessionFile: string, leafId?: string | null): SessionTreeStore {
    if (vaultPath.startsWith('/test/') || process.env.NODE_ENV === 'test') {
      const cached = SessionTreeStore.liveByKey.get(cacheKey(vaultPath, sessionFile));
      if (cached) {
        if (!cached.applyLeafId(leafId)) {
          throw new Error(`Session leaf not found: ${leafId}`);
        }
        return cached;
      }
      const store = SessionTreeStore.inMemory(vaultPath);
      if (!store.applyLeafId(leafId)) {
        throw new Error(`Session leaf not found: ${leafId}`);
      }
      return store;
    }

    requireVaultSessionFile(sessionFile);
    const absolute = toAbsoluteSessionPath(vaultPath, sessionFile);
    const sessionDir = getPiviSessionDir(vaultPath);
    const manager = SessionManager.open(absolute, sessionDir, vaultPath);
    const store = new SessionTreeStore(vaultPath, manager);
    store.captureSourceFingerprint();
    if (!store.applyLeafId(leafId)) {
      throw new Error(`Session leaf not found: ${leafId}`);
    }
    return store;
  }

  static forkFile(vaultPath: string, sessionFile: string, atEntryId: string): string | null {
    const cached = SessionTreeStore.liveByKey.get(cacheKey(vaultPath, sessionFile));
    if (cached) {
      return cached.forkToNewFile(atEntryId);
    }
    if (vaultPath.startsWith('/test/') || process.env.NODE_ENV === 'test') {
      const source = SessionTreeStore.open(vaultPath, sessionFile);
      return source.forkToNewFile(atEntryId);
    }

    requireVaultSessionFile(sessionFile);
    const absolute = toAbsoluteSessionPath(vaultPath, sessionFile);
    const sessionDir = getPiviSessionDir(vaultPath);
    const manager = SessionManager.open(absolute, sessionDir, vaultPath);
    const source = captureSessionJsonlSource(absolute);
    assertSessionJsonlSourceUnchanged(absolute, source);
    const newPath = createBranchedSessionWithCompensation(vaultPath, manager, atEntryId);
    if (!newPath) {
      return null;
    }
    invalidateSessionJsonlIndex(newPath);
    return toVaultRelativePath(vaultPath, newPath);
  }

  static inMemory(vaultPath: string): SessionTreeStore {
    return new SessionTreeStore(vaultPath, SessionManager.inMemory(vaultPath));
  }

  getVaultRelativeSessionFile(): string | null {
    const file = this.manager.getSessionFile();
    if (!file) {
      return null;
    }
    return toVaultRelativePath(this.vaultPath, file);
  }

  getSessionId(): string {
    return this.manager.getSessionId();
  }

  getLeafId(): string | null {
    return this.manager.getLeafId();
  }

  /** Switch leaf when the entry exists; null means before the first entry. */
  applyLeafId(leafId?: string | null): boolean {
    if (leafId === undefined) {
      return true;
    }
    if (leafId === null) {
      this.manager.resetLeaf();
      return true;
    }
    if (this.manager.getEntry(leafId)) {
      this.manager.branch(leafId);
      return true;
    }
    return false;
  }

  /** Rewrite this session to the append-order prefix ending at `entryId`. */
  truncateAfter(entryId: string | null): boolean {
    this.assertWritableSource();
    // Pi does not currently expose a public truncate API. Private access stays in
    // piSessionManagerPrivateAdapter so a missing capability fails before mutation.
    if (!truncatePersistedSessionManager(this.manager, entryId)) {
      return false;
    }
    this.rewriteToDisk();
    this.registerLive();
    return true;
  }

  loadAgentMessages(): AgentMessage[] {
    const entries = this.getLinearLlmContextEntries();
    const messages = applyPersistedAsyncSubagentResults(
      buildSessionContext(entries).messages,
      this.getEntries(),
    );
    return sanitizeAgentMessagesForLlm(messages);
  }

  getBranch(leafId?: string): SessionEntry[] {
    const id = leafId ?? this.manager.getLeafId();
    if (!id) {
      return [];
    }
    return this.manager.getBranch(id);
  }

  /**
   * Linear restore view: ignore tree leaves and expose file-order entries up to
   * the latest visible user/assistant message plus any trailing compactions.
   * Internal custom boundaries remain hidden. Fork still uses Pi's tree helper
   * to create a new file, but restoring an existing session is linear.
   */
  getLinearVisiblePrefix(): SessionEntry[] {
    const entries = this.getEntries();
    const visibleLeafId = findLastVisibleConversationEntryId(entries);
    if (!visibleLeafId) {
      return entries;
    }
    const visibleIndex = entries.findIndex((entry) => entry.id === visibleLeafId);
    if (visibleIndex < 0) {
      return entries;
    }
    return [
      ...entries.slice(0, visibleIndex + 1),
      ...entries.slice(visibleIndex + 1).filter((entry) => entry.type === 'compaction'),
    ];
  }

  /**
   * Linear model context view: Pivi restores sessions by append order, while
   * tool results and compaction entries after the last visible user/assistant
   * still affect the next LLM request. Include every entry through the final
   * model-context entry while excluding trailing UI metadata.
   */
  getLinearLlmContextEntries(): SessionEntry[] {
    const entries = this.getEntries();
    let lastContextIndex = -1;
    for (let index = 0; index < entries.length; index++) {
      const entry = entries[index];
      if (entry && isLlmContextEntry(entry)) {
        lastContextIndex = index;
      }
    }
    return lastContextIndex >= 0 ? entries.slice(0, lastContextIndex + 1) : entries;
  }

  /** Pi-native compaction-aware context entries for planning the next summary. */
  getActiveLlmContextEntries(): SessionEntry[] {
    return buildContextEntries(this.getLinearLlmContextEntries());
  }

  findLastVisibleMessageEntryId(role: 'user' | 'assistant'): string | null {
    return findLastVisibleConversationEntryId(this.getLinearVisiblePrefix(), role);
  }

  getEntries(): SessionEntry[] {
    return this.manager.getEntries();
  }

  appendUserMessage(content: string, images?: ImageAttachment[]): string {
    this.assertWritableSource();
    const journalEntry = this.persistJournalIntent({ kind: 'user', content, images });
    if (images && images.length > 0) {
      const parts: Array<TextContent | ImageContent> = [
        { type: 'text', text: content },
        ...toPiImageContent(images),
      ];
      const imageEntryId = this.manager.appendMessage({
        role: 'user',
        content: parts,
        timestamp: Date.now(),
      });
      this.refreshIndexAfterAppend([imageEntryId], journalEntry);
      this.registerLive();
      return imageEntryId;
    }
    const entryId = this.manager.appendMessage({
      role: 'user',
      content,
      timestamp: Date.now(),
    });
    this.refreshIndexAfterAppend([entryId], journalEntry);
    this.registerLive();
    return entryId;
  }

  /** Append agent messages not yet present in the session leaf branch. */
  syncAgentMessages(agentMessages: AgentMessage[], options?: MissingAgentMessagesOptions): void {
    const sessionContext = this.loadAgentMessages();
    const missingMessages = missingAgentMessages(sessionContext, agentMessages, options);
    if (missingMessages.length === 0) {
      return;
    }
    this.assertWritableSource();
    for (const message of missingMessages) {
      const journalEntry = this.persistJournalIntent({
        kind: 'agent',
        messages: [message as unknown as Record<string, unknown>],
      });
      const entryId = this.manager.appendMessage(
        message as Parameters<SessionManager['appendMessage']>[0],
      );
      this.refreshIndexAfterAppend([entryId], journalEntry);
    }
    this.registerLive();
  }

  appendCustomMeta(data: PiviSessionMetaData): string {
    this.assertWritableSource();
    const journalEntry = this.persistJournalIntent({ kind: 'custom', customType: PIVI_SESSION_META, data: { ...data } });
    const entryId = this.manager.appendCustomEntry(PIVI_SESSION_META, data);
    this.refreshIndexAfterAppend([entryId], journalEntry);
    this.registerLive();
    return entryId;
  }

  appendUiContext(data: PiviUiContextData): string {
    this.assertWritableSource();
    const journalEntry = this.persistJournalIntent({ kind: 'custom', customType: PIVI_UI_CONTEXT, data: { ...data } });
    const entryId = this.manager.appendCustomEntry(PIVI_UI_CONTEXT, data);
    this.refreshIndexAfterAppend([entryId], journalEntry);
    this.registerLive();
    return entryId;
  }

  appendMessageUi(data: PiviMessageUiData): string {
    this.assertWritableSource();
    const { sanitized } = sanitizeMessageUiForJsonl(data);
    const journalEntry = this.persistJournalIntent({ kind: 'custom', customType: PIVI_MESSAGE_UI, data: { ...sanitized } });
    const entryId = this.manager.appendCustomEntry(PIVI_MESSAGE_UI, sanitized);
    this.refreshIndexAfterAppend([entryId], journalEntry);
    this.registerLive();
    return entryId;
  }

  appendCompaction(
    summary: string,
    firstKeptEntryId: string,
    tokensBefore: number,
    details?: PiviCompactionDetails,
  ): string {
    this.assertWritableSource();
    const validatedDetails = details ? parsePiviCompactionDetails(details) ?? undefined : undefined;
    const journalEntry = this.persistJournalIntent({
      kind: 'compaction', summary, firstKeptEntryId, tokensBefore,
      ...(validatedDetails ? { details: { ...validatedDetails } } : {}),
    });
    const entryId = this.manager.appendCompaction(
      summary,
      firstKeptEntryId,
      tokensBefore,
      validatedDetails,
    );
    this.refreshIndexAfterAppend([entryId], journalEntry);
    this.registerLive();
    return entryId;
  }

  /**
   * Append a standard Pi compaction whose kept boundary is a context-invisible
   * custom entry. Pi therefore rebuilds the next LLM context as NOTE₂ only.
   */
  appendFullReplacementCompaction(
    tokensBefore: number,
    createCheckpoint: (boundaryId: string) => Checkpoint,
    renderSummary: (checkpoint: Checkpoint) => string,
  ): {
    boundaryId: string;
    checkpoint: Checkpoint;
    compactionId: string;
    summary: string;
  } {
    this.assertWritableSource();
    const journalEntry = this.persistJournalIntent({
      kind: 'custom', customType: PIVI_COMPACTION_BOUNDARY, data: { schemaVersion: 1 },
    });
    const boundaryId = this.manager.appendCustomEntry(PIVI_COMPACTION_BOUNDARY, {
      schemaVersion: 1,
    });
    this.refreshIndexAfterAppend([boundaryId], journalEntry);

    const boundedCheckpoint = createCheckpoint(boundaryId);
    const details = parsePiviCompactionDetails({
      piviCheckpoint: boundedCheckpoint,
    });
    if (!details) {
      throw new Error('Invalid Pivi checkpoint for full-replacement compaction.');
    }
    const summary = renderSummary(details.piviCheckpoint).trim();
    if (!summary) {
      throw new Error('Full-replacement compaction summary is empty.');
    }
    const compactionId = this.appendCompaction(
      summary,
      boundaryId,
      tokensBefore,
      details,
    );
    return {
      boundaryId,
      checkpoint: details.piviCheckpoint,
      compactionId,
      summary,
    };
  }

  /** Fork to a new JSONL file at `atEntryId`; returns vault-relative path. */
  forkToNewFile(atEntryId: string): string | null {
    this.assertWritableSource();
    const source = this.manager.getSessionFile();
    let newPath: string | null;
    try {
      newPath = createBranchedSessionWithCompensation(
        this.vaultPath,
        this.manager,
        atEntryId,
      );
    } catch (error) {
      if (source && this.manager.getSessionFile() !== source) {
        try {
          this.manager = SessionManager.open(
            source,
            getPiviSessionDir(this.vaultPath),
            this.vaultPath,
          );
        } catch (restoreError) {
          throw new AggregateError(
            [error, restoreError],
            `Session fork failed and the source session could not be reopened: ${source}`,
          );
        }
      }
      throw error;
    }
    if (!newPath) {
      return null;
    }
    invalidateSessionJsonlIndex(newPath);
    return toVaultRelativePath(this.vaultPath, newPath);
  }

}

import type { AgentMessage } from '@earendil-works/pi-agent-core';
import type { ImageContent, TextContent } from '@earendil-works/pi-ai';
import {
  buildContextEntries,
  buildSessionContext,
  type SessionEntry,
  SessionManager,
} from '@earendil-works/pi-coding-agent';
import { readFileSync } from 'fs';

import type { ImageAttachment } from '../../../foundation';
import { PluginLogger } from '../../../foundation/pluginLogger';
import {
  type AgentReport,
  type Checkpoint,
  formatAgentReportForParent,
  parseAgentReport,
  parsePiviCompactionDetails,
  type PiviCompactionDetails,
} from '../../../session/continuationSchemas';
import { sanitizeMessageUiForJsonl } from '../../../session/messageUi';
import {
  acknowledgeJournalEntry,
  createJournalEntryId,
  sealJournalEntryWithAppend,
  type SessionJournalStore,
  upsertJournalEntry,
} from '../../../session/sessionJournal';
import {
  getPiviSessionDir,
  toAbsoluteSessionPath,
  toVaultRelativePath,
} from '../../../session/sessionPaths';
import {
  PIVI_COMPACTION_BOUNDARY,
  PIVI_MESSAGE_UI,
  PIVI_SESSION_META,
  PIVI_UI_CONTEXT,
  type PiviMessageUiData,
  type PiviSessionMetaData,
  type PiviUiContextData,
  SessionIndexStaleError,
} from '../../../session/types';
import { toPiImageContent } from '../piImageContent';
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
import { findLastVisibleConversationEntryId } from './visibleSessionEntries';

const logger = new PluginLogger('SessionTreeStore');

interface BoundSessionJournal {
  store: SessionJournalStore;
  now: () => number;
}

let boundJournal: BoundSessionJournal | null = null;

/** Bind the vault-scoped device-local session journal used by live appends. */
export function bindSessionJournal(
  store: SessionJournalStore | null,
  now: () => number = () => Date.now(),
): void {
  boundJournal = store ? { store, now } : null;
}

export function getBoundSessionJournal(): SessionJournalStore | null {
  return boundJournal?.store ?? null;
}

function cacheKey(vaultPath: string, sessionFile: string): string {
  return `${vaultPath}::${sessionFile}`;
}

function isLlmContextControlEntry(entry: SessionEntry): boolean {
  return entry.type === 'compaction';
}

interface AsyncSubagentPersistedResult {
  agentId?: string;
  status: 'completed' | 'error';
  result: string;
  report?: AgentReport;
}

function collectPersistedAsyncSubagentResults(
  entries: SessionEntry[],
): Map<string, AsyncSubagentPersistedResult> {
  const results = new Map<string, AsyncSubagentPersistedResult>();
  for (const entry of entries) {
    if (entry.type !== 'custom' || entry.customType !== PIVI_MESSAGE_UI) {
      continue;
    }
    const data = entry.data as PiviMessageUiData | undefined;
    for (const toolCall of data?.toolCalls ?? []) {
      const subagent = toolCall.subagent;
      if (!subagent || subagent.mode !== 'async') {
        continue;
      }
      const status = subagent.asyncStatus ?? subagent.status;
      if (status !== 'completed' && status !== 'error') {
        continue;
      }
      const result = subagent.result?.trim() || toolCall.result?.trim();
      if (!result) {
        continue;
      }
      const report = parseAgentReport(toolCall.toolUseResult?.agent_report);
      results.set(toolCall.id, {
        agentId: subagent.agentId,
        status,
        result,
        ...(report ? { report } : {}),
      });
    }
  }
  return results;
}

function formatPersistedAsyncSubagentResult(result: AsyncSubagentPersistedResult): string {
  const statusText = result.status === 'error' ? 'failed' : 'completed';
  const header = result.agentId
    ? `Background sub-agent ${result.agentId} ${statusText}.`
    : `Background sub-agent ${statusText}.`;
  return `${header}\n\n${result.report
    ? formatAgentReportForParent(result.report)
    : result.result}`;
}

function applyPersistedAsyncSubagentResults(
  messages: AgentMessage[],
  entries: SessionEntry[],
): AgentMessage[] {
  const results = collectPersistedAsyncSubagentResults(entries);
  if (results.size === 0) {
    return messages;
  }

  let changed = false;
  const next = messages.map((message) => {
    const record = message as unknown as Record<string, unknown>;
    if (record.role !== 'toolResult' || record.toolName !== 'spawn_agent') {
      return message;
    }
    const toolCallId = typeof record.toolCallId === 'string' ? record.toolCallId : null;
    const result = toolCallId ? results.get(toolCallId) : undefined;
    if (!result) {
      return message;
    }
    changed = true;
    return {
      ...record,
      content: [{ type: 'text', text: formatPersistedAsyncSubagentResult(result) }],
      isError: result.status === 'error',
    } as unknown as AgentMessage;
  });

  return changed ? next : messages;
}

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

  private refreshIndexAfterAppend(entryIds: readonly string[]): void {
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
      this.recordAndAckJournal(sessionFile, relative, baseFingerprint, entryIds);
    } catch (error) {
      this.evictLive();
      throw error;
    }
  }

  /**
   * After a successful JSONL append, seal the continuation into the device-local
   * journal and mark it confirmed. Confirmed rows are retained until the next
   * confirmed append for the same session or startup verification removes them.
   */
  private recordAndAckJournal(
    absoluteSessionFile: string,
    relativeSessionFile: string | null,
    baseFingerprint: SessionJsonlSourceFingerprint,
    entryIds: readonly string[],
  ): void {
    if (!boundJournal || !relativeSessionFile || !this.sourceFingerprint) {
      return;
    }
    try {
      const baseSize = baseFingerprint.size;
      const content = readFileSync(absoluteSessionFile);
      if (content.length < baseSize) {
        return;
      }
      const appended = content.subarray(baseSize).toString('utf8');
      if (!appended) {
        return;
      }
      const lines = appended.endsWith('\n')
        ? appended.slice(0, -1).split('\n')
        : appended.split('\n');
      const createdAt = boundJournal.now();
      const intent = { kind: 'jsonl-lines' as const, lines };
      const id = createJournalEntryId(
        relativeSessionFile,
        baseFingerprint,
        intent,
        createdAt,
      );
      const sealed = sealJournalEntryWithAppend(
        {
          version: 1,
          id,
          sessionFile: relativeSessionFile,
          createdAt,
          status: 'intent',
          baseFingerprint,
          intent,
        },
        entryIds,
        lines,
        this.sourceFingerprint,
      );
      let state = boundJournal.store.load();
      state = upsertJournalEntry(state, sealed);
      // Persist pending before confirmation so a crash mid-ack remains recoverable.
      boundJournal.store.save(state);
      state = acknowledgeJournalEntry(state, id);
      boundJournal.store.save(state);
    } catch (error) {
      logger.warn('Failed to confirm session journal after append', {
        sessionFile: relativeSessionFile,
        error: error instanceof Error ? error.message : String(error),
      });
    }
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

    const absolute = toAbsoluteSessionPath(vaultPath, sessionFile);
    const sessionDir = getPiviSessionDir(vaultPath);
    const manager = SessionManager.open(absolute, sessionDir, vaultPath);
    const source = captureSessionJsonlSource(absolute);
    assertSessionJsonlSourceUnchanged(absolute, source);
    const newPath = manager.createBranchedSession(atEntryId);
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

  getVisiblePrefix(leafId?: string | null): SessionEntry[] {
    const branch = leafId === null ? [] : this.getBranch(leafId ?? undefined);
    const visibleLeafId = findLastVisibleConversationEntryId(branch);
    if (!visibleLeafId) {
      return branch;
    }

    const entries = this.getEntries();
    const visibleIndex = entries.findIndex((entry) => entry.id === visibleLeafId);
    return visibleIndex >= 0 ? entries.slice(0, visibleIndex + 1) : branch;
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
   * compaction entries after the last visible message still affect the next LLM
   * context. Include the latest visible message prefix plus trailing compaction
   * control entries so manual compaction immediately updates the active agent.
   */
  getLinearLlmContextEntries(): SessionEntry[] {
    const entries = this.getEntries();
    const visibleLeafId = findLastVisibleConversationEntryId(entries);
    const visibleIndex = visibleLeafId
      ? entries.findIndex((entry) => entry.id === visibleLeafId)
      : -1;
    let lastContextIndex = visibleIndex;
    for (let index = 0; index < entries.length; index++) {
      const entry = entries[index];
      if (entry && isLlmContextControlEntry(entry)) {
        lastContextIndex = Math.max(lastContextIndex, index);
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
      this.refreshIndexAfterAppend([imageEntryId]);
      this.registerLive();
      return imageEntryId;
    }
    const entryId = this.manager.appendMessage({
      role: 'user',
      content,
      timestamp: Date.now(),
    });
    this.refreshIndexAfterAppend([entryId]);
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
    const entryIds: string[] = [];
    for (const message of missingMessages) {
      entryIds.push(this.manager.appendMessage(
        message as Parameters<SessionManager['appendMessage']>[0],
      ));
    }
    this.refreshIndexAfterAppend(entryIds);
    this.registerLive();
  }

  appendCustomMeta(data: PiviSessionMetaData): string {
    this.assertWritableSource();
    const entryId = this.manager.appendCustomEntry(PIVI_SESSION_META, data);
    this.refreshIndexAfterAppend([entryId]);
    this.registerLive();
    return entryId;
  }

  appendUiContext(data: PiviUiContextData): string {
    this.assertWritableSource();
    const entryId = this.manager.appendCustomEntry(PIVI_UI_CONTEXT, data);
    this.refreshIndexAfterAppend([entryId]);
    this.registerLive();
    return entryId;
  }

  appendMessageUi(data: PiviMessageUiData): string {
    this.assertWritableSource();
    const { sanitized } = sanitizeMessageUiForJsonl(data);
    const entryId = this.manager.appendCustomEntry(PIVI_MESSAGE_UI, sanitized);
    this.refreshIndexAfterAppend([entryId]);
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
    const entryId = this.manager.appendCompaction(
      summary,
      firstKeptEntryId,
      tokensBefore,
      validatedDetails,
    );
    this.refreshIndexAfterAppend([entryId]);
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
    const boundaryId = this.manager.appendCustomEntry(PIVI_COMPACTION_BOUNDARY, {
      schemaVersion: 1,
    });
    this.refreshIndexAfterAppend([boundaryId]);

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
    const newPath = this.manager.createBranchedSession(atEntryId);
    if (!newPath) {
      return null;
    }
    invalidateSessionJsonlIndex(newPath);
    return toVaultRelativePath(this.vaultPath, newPath);
  }

  static async listSessionFiles(vaultPath: string): Promise<string[]> {
    const sessionDir = getPiviSessionDir(vaultPath);
    const sessions = await SessionManager.list(vaultPath, sessionDir);
    return sessions.map((info) => toVaultRelativePath(vaultPath, info.path));
  }
}

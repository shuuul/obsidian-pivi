import type { AgentMessage } from '@earendil-works/pi-agent-core';
import type { ImageContent, TextContent } from '@earendil-works/pi-ai';
import {
  buildSessionContext,
  type SessionEntry,
  SessionManager,
  type SessionTreeNode,
} from '@earendil-works/pi-coding-agent/dist/core/session-manager.js';
import type { ImageAttachment } from '@pivi/pivi-agent-core/foundation';
import {
  getPiviSessionDir,
  toAbsoluteSessionPath,
  toVaultRelativePath,
} from '@pivi/pivi-agent-core/session/sessionPaths';
import {
  PIVI_MESSAGE_UI,
  PIVI_SESSION_META,
  PIVI_UI_CONTEXT,
  type PiviMessageUiData,
  type PiviSessionMetaData,
  type PiviUiContextData,
} from '@pivi/pivi-agent-core/session/types';

import { toPiImageContent } from '../piImageContent';
import {
  missingAgentMessages,
  type MissingAgentMessagesOptions,
  sanitizeAgentMessagesForLlm,
} from './agentMessageHistory';
import { findLastVisibleConversationEntryId } from './visibleSessionEntries';


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
      results.set(toolCall.id, {
        agentId: subagent.agentId,
        status,
        result,
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
  return `${header}\n\n${result.result}`;
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

  /** Write header + entries before the first assistant turn (pi normally defers flush). */
  flushToDisk(): void {
    if (!this.manager.isPersisted()) {
      return;
    }
    const manager = this.manager as unknown as {
      _rewriteFile(): void;
      flushed?: boolean;
    };
    manager._rewriteFile();
    // Pi normally creates the file lazily on the first assistant message. Since
    // Pivi flushes earlier so history rows exist immediately, keep Pi's lazy
    // writer state in sync or the next append tries to create an existing file.
    manager.flushed = true;
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
    store.flushToDisk();
    store.registerLive();
    return store;
  }

  static open(vaultPath: string, sessionFile: string, leafId?: string | null): SessionTreeStore {
    const cached = SessionTreeStore.liveByKey.get(cacheKey(vaultPath, sessionFile));
    if (cached) {
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
    if (!store.applyLeafId(leafId)) {
      throw new Error(`Session leaf not found: ${leafId}`);
    }
    return store;
  }

  static forkFile(vaultPath: string, sessionFile: string, atEntryId: string): string | null {
    if (vaultPath.startsWith('/test/') || process.env.NODE_ENV === 'test') {
      const source = SessionTreeStore.open(vaultPath, sessionFile);
      return source.forkToNewFile(atEntryId);
    }

    const absolute = toAbsoluteSessionPath(vaultPath, sessionFile);
    const sessionDir = getPiviSessionDir(vaultPath);
    const manager = SessionManager.open(absolute, sessionDir, vaultPath);
    const newPath = manager.createBranchedSession(atEntryId);
    if (!newPath) {
      return null;
    }
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

  setLeaf(leafId: string | null): boolean {
    return this.applyLeafId(leafId);
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
   * the latest visible user/assistant message. Fork still uses Pi's tree helper
   * to create a new file, but restoring an existing session is linear.
   */
  getLinearVisiblePrefix(): SessionEntry[] {
    const entries = this.getEntries();
    const visibleLeafId = findLastVisibleConversationEntryId(entries);
    if (!visibleLeafId) {
      return entries;
    }
    const visibleIndex = entries.findIndex((entry) => entry.id === visibleLeafId);
    return visibleIndex >= 0 ? entries.slice(0, visibleIndex + 1) : entries;
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
      if (isLlmContextControlEntry(entries[index])) {
        lastContextIndex = Math.max(lastContextIndex, index);
      }
    }
    return lastContextIndex >= 0 ? entries.slice(0, lastContextIndex + 1) : entries;
  }

  findLastVisibleMessageEntryId(role: 'user' | 'assistant'): string | null {
    return findLastVisibleConversationEntryId(this.getLinearVisiblePrefix(), role);
  }

  getEntries(): SessionEntry[] {
    return this.manager.getEntries();
  }

  getTree(): SessionTreeNode[] {
    return this.manager.getTree();
  }

  appendUserMessage(content: string, images?: ImageAttachment[]): string {
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
      this.flushToDisk();
      this.registerLive();
      return imageEntryId;
    }
    const entryId = this.manager.appendMessage({
      role: 'user',
      content,
      timestamp: Date.now(),
    });
    this.flushToDisk();
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
    for (const message of missingMessages) {
      this.manager.appendMessage(message as Parameters<SessionManager['appendMessage']>[0]);
    }
    this.flushToDisk();
    this.registerLive();
  }

  appendCustomMeta(data: PiviSessionMetaData): string {
    const entryId = this.manager.appendCustomEntry(PIVI_SESSION_META, data);
    this.flushToDisk();
    this.registerLive();
    return entryId;
  }

  appendUiContext(data: PiviUiContextData): string {
    const entryId = this.manager.appendCustomEntry(PIVI_UI_CONTEXT, data);
    this.flushToDisk();
    this.registerLive();
    return entryId;
  }

  appendMessageUi(data: PiviMessageUiData): string {
    const entryId = this.manager.appendCustomEntry(PIVI_MESSAGE_UI, data);
    this.flushToDisk();
    this.registerLive();
    return entryId;
  }

  appendCompaction(summary: string, firstKeptEntryId: string, tokensBefore: number): string {
    const entryId = this.manager.appendCompaction(summary, firstKeptEntryId, tokensBefore);
    this.flushToDisk();
    this.registerLive();
    return entryId;
  }

  /** Fork to a new JSONL file at `atEntryId`; returns vault-relative path. */
  forkToNewFile(atEntryId: string): string | null {
    const newPath = this.manager.createBranchedSession(atEntryId);
    if (!newPath) {
      return null;
    }
    return toVaultRelativePath(this.vaultPath, newPath);
  }

  static async listSessionFiles(vaultPath: string): Promise<string[]> {
    const sessionDir = getPiviSessionDir(vaultPath);
    const sessions = await SessionManager.list(vaultPath, sessionDir);
    return sessions.map((info) => toVaultRelativePath(vaultPath, info.path));
  }
}

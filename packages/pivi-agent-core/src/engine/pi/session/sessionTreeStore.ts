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
  sanitizeAgentMessagesForLlm,
} from './agentMessageHistory';
import { findLastVisibleConversationEntryId } from './visibleSessionEntries';


function cacheKey(vaultPath: string, sessionFile: string): string {
  return `${vaultPath}::${sessionFile}`;
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
    return sanitizeAgentMessagesForLlm(buildSessionContext(this.getEntries()).messages);
  }

  private loadRawAgentMessages(): AgentMessage[] {
    return this.getLinearVisiblePrefix()
      .filter((entry): entry is SessionEntry & { type: 'message' } => entry.type === 'message')
      .map((entry) => entry.message);
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
  syncAgentMessages(agentMessages: AgentMessage[]): void {
    const sessionContext = this.loadRawAgentMessages();
    const missingMessages = missingAgentMessages(sessionContext, agentMessages);
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

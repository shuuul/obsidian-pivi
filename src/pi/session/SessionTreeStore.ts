import type { AgentMessage } from '@earendil-works/pi-agent-core';
import type { ImageContent, TextContent } from '@earendil-works/pi-ai';
import {
  type SessionEntry,
  SessionManager,
  type SessionTreeNode,
} from '@earendil-works/pi-coding-agent/dist/core/session-manager.js';

import type { ImageAttachment } from '../../core/types/chat';
import {
  missingAgentMessages,
  sanitizeAgentMessagesForLlm,
} from './agentMessageHistory';
import {
  PIVI_MESSAGE_UI,
  PIVI_SESSION_META,
  PIVI_UI_CONTEXT,
  type PiviMessageUiData,
  type PiviSessionMetaData,
  type PiviUiContextData,
} from './piviCustomTypes';
import { getPiviSessionDir } from './piviSessionPaths';
import { toAbsoluteSessionPath, toVaultRelativePath } from './sessionPathUtils';


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
    (this.manager as unknown as { _rewriteFile(): void })._rewriteFile();
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

  static open(vaultPath: string, sessionFile: string, leafId?: string): SessionTreeStore {
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

  /** Switch leaf when the entry exists; otherwise keep the file's default leaf. */
  applyLeafId(leafId?: string | null): void {
    if (!leafId) {
      return;
    }
    if (this.manager.getEntry(leafId)) {
      this.manager.branch(leafId);
    }
  }

  setLeaf(leafId: string): void {
    this.applyLeafId(leafId);
  }

  loadAgentMessages(): AgentMessage[] {
    return sanitizeAgentMessagesForLlm(this.manager.buildSessionContext().messages);
  }

  getBranch(leafId?: string): SessionEntry[] {
    const id = leafId ?? this.manager.getLeafId();
    if (!id) {
      return [];
    }
    return this.manager.getBranch(id);
  }

  getEntries(): SessionEntry[] {
    return this.manager.getEntries();
  }

  getTree(): SessionTreeNode[] {
    return this.manager.getTree();
  }

  appendUserMessage(content: string, images?: ImageAttachment[]): string {
    if (images && images.length > 0) {
      const parts: Array<TextContent | ImageContent> = [{ type: 'text', text: content }];
      for (const img of images) {
        parts.push({
          type: 'image',
          mimeType: img.mediaType,
          data: img.data,
        });
      }
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
    const sessionContext = this.manager.buildSessionContext().messages;
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
    return this.manager.appendCustomEntry(PIVI_UI_CONTEXT, data);
  }

  appendMessageUi(data: PiviMessageUiData): string {
    return this.manager.appendCustomEntry(PIVI_MESSAGE_UI, data);
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

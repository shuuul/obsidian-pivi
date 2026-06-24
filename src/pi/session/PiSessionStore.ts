import type { AgentMessage } from '@earendil-works/pi-agent-core';
import type { SessionTreeNode } from '@earendil-works/pi-coding-agent/dist/core/session-manager.js';
import { SessionManager } from '@earendil-works/pi-coding-agent/dist/core/session-manager.js';

import type {
  LeafSummary,
  MessageUiPatch,
  PersistedAgentMessage,
  SessionMetaPatch,
  SessionRef,
  SessionStore,
  SessionSummary,
  SessionUiContext,
  UserTurnUi,
} from '../../core/session/types';
import type { VaultFileAdapter } from '../../core/storage/VaultFileAdapter';
import type { ChatMessage } from '../../core/types/chat';
import {
  collectMessageUiMap,
  entriesToChatMessages,
  firstUserMessagePreview,
  readSessionMetaFromBranch,
} from './MessageMapper';
import {
  OBSIUS_UI_CONTEXT,
  type ObsiusSessionMetaData,
  type ObsiusUiContextData,
} from './obsiusCustomTypes';
import { getObsiusSessionDir } from './obsiusSessionPaths';
import { toAbsoluteSessionPath } from './sessionPathUtils';
import { SessionTreeStore } from './SessionTreeStore';

export function collectLeafSummaries(nodes: SessionTreeNode[]): LeafSummary[] {
  const leavesByVisibleLeaf = new Map<string, LeafSummary>();

  const walk = (node: SessionTreeNode): void => {
    if (node.children.length === 0) {
      const branch = branchFromLeaf(nodes, node);
      const uiMap = collectMessageUiMap(branch);
      const messages = entriesToChatMessages(branch, uiMap);
      const visibleLeafId = findLastVisibleConversationEntryId(branch);
      if (!visibleLeafId || messages.length === 0) {
        return;
      }
      const last = messages[messages.length - 1];
      const summary: LeafSummary = {
        leafId: node.entry.id,
        label: node.label,
        updatedAt: Date.parse(node.entry.timestamp) || Date.now(),
        messagePreview: last?.content?.slice(0, 50) ?? '',
        messageCount: messages.length,
        depth: messages.length,
      };
      const existing = leavesByVisibleLeaf.get(visibleLeafId);
      if (!existing || summary.updatedAt > existing.updatedAt) {
        leavesByVisibleLeaf.set(visibleLeafId, summary);
      }
      return;
    }
    for (const child of node.children) {
      walk(child);
    }
  };

  for (const root of nodes) {
    walk(root);
  }

  return [...leavesByVisibleLeaf.values()].sort((a, b) => b.updatedAt - a.updatedAt);
}

function branchFromLeaf(roots: SessionTreeNode[], leaf: SessionTreeNode): SessionTreeNode['entry'][] {
  const branch = [leaf.entry];
  let cursor: SessionTreeNode | undefined = leaf;
  while (cursor?.entry.parentId) {
    const parent = findParent(roots, cursor.entry.parentId);
    if (!parent) {
      break;
    }
    branch.unshift(parent.entry);
    cursor = parent;
  }
  return branch;
}

function findLastVisibleConversationEntryId(branch: SessionTreeNode['entry'][]): string | null {
  for (let i = branch.length - 1; i >= 0; i--) {
    const entry = branch[i];
    if (entry.type !== 'message') {
      continue;
    }
    const role = entry.message.role;
    if (role === 'user' || role === 'assistant') {
      return entry.id;
    }
  }
  return null;
}

function findParent(
  roots: SessionTreeNode[],
  parentId: string,
): SessionTreeNode | undefined {
  const stack = [...roots];
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (node.entry.id === parentId) {
      return node;
    }
    stack.push(...node.children);
  }
  return undefined;
}

function readUiContextFromBranch(store: SessionTreeStore, leafId: string): SessionUiContext {
  const branch = store.getBranch(leafId);
  for (let i = branch.length - 1; i >= 0; i--) {
    const entry = branch[i];
    if (entry.type !== 'custom' || entry.customType !== OBSIUS_UI_CONTEXT) {
      continue;
    }
    const data = entry.data as ObsiusUiContextData | undefined;
    if (data) {
      return {
        currentNote: data.currentNote,
        externalContextPaths: data.externalContextPaths,
        enabledMcpServers: data.enabledMcpServers,
      };
    }
  }
  return {};
}

export class PiSessionStore implements SessionStore {
  constructor(
    private readonly adapter: VaultFileAdapter,
    private readonly vaultPath: string,
  ) {}

  sessionRefFromOpenSession(openSession: {
    sessionFile?: string;
    leafId?: string | null;
    sessionId?: string | null;
    id: string;
  }): SessionRef | null {
    if (!openSession.sessionFile) {
      return null;
    }
    const leafId = typeof openSession.leafId === 'string' && openSession.leafId.length > 0
      ? openSession.leafId
      : undefined;
    return {
      sessionFile: openSession.sessionFile,
      leafId: leafId ?? '',
      sessionId: openSession.sessionId ?? openSession.id,
    };
  }

  private refFromStore(store: SessionTreeStore): SessionRef {
    const sessionFile = store.getVaultRelativeSessionFile();
    let leafId = store.getLeafId();
    if (!leafId) {
      const entries = store.getEntries();
      const lastEntry = entries[entries.length - 1];
      if (lastEntry) {
        leafId = lastEntry.id;
      }
    }
    if (!sessionFile || !leafId) {
      throw new Error('Session file or leaf is missing');
    }
    return {
      sessionFile,
      leafId,
      sessionId: store.getSessionId(),
    };
  }

  async listSessions(vaultPath: string): Promise<SessionSummary[]> {
    const sessionDir = getObsiusSessionDir(vaultPath);
    const listed = await SessionManager.list(vaultPath, sessionDir);
    const summaries: SessionSummary[] = [];

    for (const info of listed) {
      const sessionFile = info.path.includes(vaultPath)
        ? info.path.slice(vaultPath.length + 1).split(/[/\\]/).join('/')
        : info.path;
      let title = info.name?.trim() || '';
      let updatedAt = info.modified.getTime();
      let leafCount = 1;
      let messagePreview = info.firstMessage || 'New session';

      try {
        const store = SessionTreeStore.open(vaultPath, sessionFile);
        const meta = readSessionMetaFromBranch(store.getBranch());
        if (meta?.title) {
          title = meta.title;
        }
        if (meta?.lastResponseAt) {
          updatedAt = meta.lastResponseAt;
        }
        leafCount = collectLeafSummaries(store.getTree()).length || 1;
        messagePreview = firstUserMessagePreview(store.getBranch());
      } catch {
        // use SessionManager list defaults
      }

      if (!title) {
        title = messagePreview;
      }

      summaries.push({
        sessionFile,
        sessionId: info.id,
        title,
        updatedAt,
        leafCount,
        messagePreview,
      });
    }

    return summaries.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  create(vaultPath: string): Promise<SessionRef> {
    const store = SessionTreeStore.create(vaultPath);
    const now = Date.now();
    store.appendCustomMeta({
      title: new Date(now).toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      }),
      createdAt: now,
    });
    return Promise.resolve(this.refFromStore(store));
  }

  open(sessionFile: string, leafId?: string): Promise<SessionRef> {
    const store = SessionTreeStore.open(this.vaultPath, sessionFile, leafId);
    return Promise.resolve(this.refFromStore(store));
  }

  listLeaves(sessionFile: string): Promise<LeafSummary[]> {
    const store = SessionTreeStore.open(this.vaultPath, sessionFile);
    return Promise.resolve(collectLeafSummaries(store.getTree()));
  }

  getMessages(ref: SessionRef): Promise<ChatMessage[]> {
    const store = SessionTreeStore.open(this.vaultPath, ref.sessionFile, ref.leafId);
    const activeLeaf = store.getLeafId();
    const branch = activeLeaf ? store.getBranch(activeLeaf) : store.getBranch();
    const uiMap = collectMessageUiMap(branch);
    return Promise.resolve(entriesToChatMessages(branch, uiMap));
  }

  appendUserTurn(ref: SessionRef, prompt: string, ui?: UserTurnUi): Promise<SessionRef> {
    const store = SessionTreeStore.open(this.vaultPath, ref.sessionFile, ref.leafId);
    const entryId = store.appendUserMessage(prompt, ui?.images);
    if (ui?.displayContent) {
      store.appendMessageUi({
        targetEntryId: entryId,
        displayContent: ui.displayContent,
      });
    }
    return Promise.resolve(this.refFromStore(store));
  }

  appendAgentTurn(
    ref: SessionRef,
    messages: PersistedAgentMessage[],
    ui?: MessageUiPatch[],
  ): Promise<SessionRef> {
    const store = SessionTreeStore.open(this.vaultPath, ref.sessionFile, ref.leafId);
    store.syncAgentMessages(messages as unknown as AgentMessage[]);
    if (ui) {
      for (const patch of ui) {
        store.appendMessageUi(patch);
      }
    }
    return Promise.resolve(this.refFromStore(store));
  }

  setLeaf(ref: SessionRef, leafId: string): Promise<SessionRef> {
    const store = SessionTreeStore.open(this.vaultPath, ref.sessionFile, ref.leafId);
    store.setLeaf(leafId);
    return Promise.resolve(this.refFromStore(store));
  }

  fork(ref: SessionRef, atEntryId: string): Promise<SessionRef> {
    const source = SessionTreeStore.open(this.vaultPath, ref.sessionFile, ref.leafId);
    const newFile = source.forkToNewFile(atEntryId);
    if (!newFile) {
      throw new Error('Failed to fork session');
    }
    const forked = SessionTreeStore.open(this.vaultPath, newFile);
    return Promise.resolve(this.refFromStore(forked));
  }

  async deleteSession(sessionFile: string): Promise<void> {
    const absolute = toAbsoluteSessionPath(this.vaultPath, sessionFile);
    await this.adapter.delete(absolute);
  }

  readUiContext(ref: SessionRef): Promise<SessionUiContext> {
    const store = SessionTreeStore.open(this.vaultPath, ref.sessionFile, ref.leafId);
    const activeLeaf = store.getLeafId();
    return Promise.resolve(readUiContextFromBranch(store, activeLeaf ?? ''));
  }

  async writeUiContext(ref: SessionRef, patch: Partial<SessionUiContext>): Promise<void> {
    const store = SessionTreeStore.open(this.vaultPath, ref.sessionFile, ref.leafId);
    const current = await this.readUiContext(ref);
    store.appendUiContext({
      currentNote: patch.currentNote ?? current.currentNote,
      externalContextPaths: patch.externalContextPaths ?? current.externalContextPaths,
      enabledMcpServers: patch.enabledMcpServers ?? current.enabledMcpServers,
    });
    void store;
  }

  writeSessionMeta(ref: SessionRef, patch: SessionMetaPatch): Promise<void> {
    const store = SessionTreeStore.open(this.vaultPath, ref.sessionFile, ref.leafId);
    const activeLeaf = store.getLeafId();
    const branch = activeLeaf ? store.getBranch(activeLeaf) : store.getBranch();
    const existing = readSessionMetaFromBranch(branch);
    const next: ObsiusSessionMetaData = {
      title: patch.title ?? existing?.title ?? 'New session',
      createdAt: patch.createdAt ?? existing?.createdAt ?? Date.now(),
      titleGenerationStatus: patch.titleGenerationStatus ?? existing?.titleGenerationStatus,
      lastResponseAt: patch.lastResponseAt ?? existing?.lastResponseAt,
    };
    store.appendCustomMeta(next);
    ref.leafId = store.getLeafId() ?? ref.leafId;
    return Promise.resolve();
  }
}

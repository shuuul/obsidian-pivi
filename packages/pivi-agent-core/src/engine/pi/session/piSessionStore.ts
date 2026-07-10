import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { SessionEntry, SessionTreeNode } from "@earendil-works/pi-coding-agent/dist/core/session-manager.js";
import { SessionManager } from "@earendil-works/pi-coding-agent/dist/core/session-manager.js";
import { piAiModels } from '@pivi/pivi-agent-core/engine/pi/piAiModels';
import { resolvePiModelFromKeyWithLookup } from '@pivi/pivi-agent-core/engine/pi/piModelRegistry';
import type { ChatMessage, UsageInfo } from '@pivi/pivi-agent-core/foundation';
import { getPiviSessionDir, toVaultRelativePath } from '@pivi/pivi-agent-core/session/sessionPaths';
import type {
  FileStore,
  LeafSummary,
  MessageUiPatch,
  PersistedAgentMessage,
  SessionMetaPatch,
  SessionRef,
  SessionStore,
  SessionUiContext,
  StoreSessionInfo,
  UserTurnUi,
} from '@pivi/pivi-agent-core/session/types';
import {
  PIVI_UI_CONTEXT,
  type PiviSessionMetaData,
  type PiviUiContextData,
} from '@pivi/pivi-agent-core/session/types';
import { loadRuntimeVaultSkills } from '@pivi/pivi-agent-core/skills/vault/loadVaultSkills';

import {
  applySkillDescriptions,
  collectMessageUiMap,
  entriesToChatMessages,
  firstUserMessagePreview,
  readSessionMetaFromBranch,
} from './messageMapper';
import { SessionTreeStore } from './sessionTreeStore';
import { findLastVisibleConversationEntryId } from './visibleSessionEntries';

function entriesThroughVisibleEntry(
  entries: SessionEntry[],
  visibleEntryId: string,
  fallback: SessionEntry[],
): SessionEntry[] {
  const visibleIndex = entries.findIndex((entry) => entry.id === visibleEntryId);
  return visibleIndex >= 0 ? entries.slice(0, visibleIndex + 1) : fallback;
}

function countHumanTurns(messages: ChatMessage[]): number {
  return messages.filter((message) => message.role === "user").length;
}

function previewForMessages(messages: ChatMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (!message) {
      continue;
    }
    const content = (message.displayContent !== undefined
      ? message.displayContent
      : message.content).trim();
    if (content) {
      return content.slice(0, 50);
    }
  }
  return "";
}

function stableJson(value: unknown): string {
  if (value === undefined) {
    return 'undefined';
  }
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(',')}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => (
    `${JSON.stringify(key)}:${stableJson(record[key])}`
  )).join(',')}}`;
}

function patchAlreadyPersisted(
  current: MessageUiPatch | undefined,
  patch: MessageUiPatch,
): boolean {
  const patchKeys = Object.keys(patch)
    .filter((key) => key !== 'targetEntryId') as Array<keyof MessageUiPatch>;
  if (patchKeys.length === 0) {
    return true;
  }
  if (!current) {
    return false;
  }
  return patchKeys.every((key) => stableJson(current[key]) === stableJson(patch[key]));
}

function mergeMessageUiPatch(
  current: MessageUiPatch | undefined,
  patch: MessageUiPatch,
): MessageUiPatch {
  return {
    ...current,
    ...patch,
  };
}

function arraysEqual(a: readonly string[] | undefined, b: readonly string[] | undefined): boolean {
  if (a === b) {
    return true;
  }
  if (!a || !b || a.length !== b.length) {
    return false;
  }
  return a.every((value, index) => value === b[index]);
}

function uiContextEqual(a: SessionUiContext, b: SessionUiContext): boolean {
  return a.currentNote === b.currentNote
    && arraysEqual(a.externalContextPaths, b.externalContextPaths)
    && arraysEqual(a.enabledMcpServers, b.enabledMcpServers);
}

function sessionMetaEqual(
  a: PiviSessionMetaData | null | undefined,
  b: PiviSessionMetaData,
): boolean {
  return !!a
    && a.title === b.title
    && a.titleSource === b.titleSource
    && a.createdAt === b.createdAt
    && a.titleGenerationStatus === b.titleGenerationStatus
    && a.lastResponseAt === b.lastResponseAt;
}

function entryUpdatedAt(entry: SessionEntry): number {
  const messageTimestamp = entry.type === "message" && typeof entry.message.timestamp === "number"
    ? entry.message.timestamp
    : undefined;
  return messageTimestamp ?? (Date.parse(entry.timestamp) || Date.now());
}

export function collectLeafSummaries(
  nodes: SessionTreeNode[],
  entries: SessionEntry[] = [],
): LeafSummary[] {
  const leavesByVisibleLeaf = new Map<string, LeafSummary>();
  const fullUiMap = collectMessageUiMap(entries);

  const walk = (node: SessionTreeNode): void => {
    if (node.children.length === 0) {
      const branch = branchFromLeaf(nodes, node);
      const visibleLeafId = findLastVisibleConversationEntryId(branch);
      if (!visibleLeafId) {
        return;
      }
      if (!branch.some((entry) => entry.id === visibleLeafId)) {
        return;
      }
      const prefixEntries = entriesThroughVisibleEntry(entries, visibleLeafId, branch);
      const uiMap = entries.length > 0 ? fullUiMap : collectMessageUiMap(branch);
      const messages = entriesToChatMessages(prefixEntries, uiMap);
      const turnCount = countHumanTurns(messages);
      if (messages.length === 0 || turnCount === 0) {
        return;
      }
      const summary: LeafSummary = {
        leafId: node.entry.id,
        updatedAt: entryUpdatedAt(node.entry),
        messagePreview: previewForMessages(messages),
        messageCount: messages.length,
        turnCount,
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

  return [...leavesByVisibleLeaf.values()].sort(
    (a, b) => b.updatedAt - a.updatedAt,
  );
}

export function latestVisibleLeafId(nodes: SessionTreeNode[]): string | null {
  return collectLeafSummaries(nodes)[0]?.leafId ?? null;
}

function branchFromLeaf(
  roots: SessionTreeNode[],
  leaf: SessionTreeNode,
): SessionTreeNode["entry"][] {
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

export class PiSessionStore implements SessionStore {
  constructor(
    private readonly adapter: FileStore,
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
    return {
      sessionFile: openSession.sessionFile,
      sessionId: openSession.sessionId ?? openSession.id,
    };
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
    const sessionDir = getPiviSessionDir(vaultPath);
    const listed = await SessionManager.list(vaultPath, sessionDir);
    const summaries: StoreSessionInfo[] = [];

    for (const info of listed) {
      const sessionFile = info.path.includes(vaultPath)
        ? info.path
            .slice(vaultPath.length + 1)
            .split(/[/\\]/)
            .join("/")
        : info.path;
      let title = info.name?.trim() || "";
      let updatedAt = info.modified.getTime();
      let leafCount = 1;
      let messagePreview = info.firstMessage || "New session";

      try {
        const store = SessionTreeStore.openSnapshot(vaultPath, sessionFile);
        const linearEntries = store.getLinearVisiblePrefix();
        const meta = readSessionMetaFromBranch(store.getEntries());
        if (meta?.title) {
          title = meta.title;
        }
        const titleSource = meta?.titleSource;
        if (meta?.lastResponseAt) {
          updatedAt = meta.lastResponseAt;
        }
        leafCount = 1;
        messagePreview = firstUserMessagePreview(linearEntries);
        summaries.push({
          sessionFile,
          sessionId: info.id,
          title: title || messagePreview,
          ...(titleSource ? { titleSource } : {}),
          updatedAt,
          leafCount,
          messagePreview,
        });
        continue;
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

  open(sessionFile: string, _leafId?: string | null): Promise<SessionRef> {
    const store = SessionTreeStore.openSnapshot(this.vaultPath, sessionFile);
    return Promise.resolve(this.refFromStore(store));
  }

  listLeaves(sessionFile: string): Promise<LeafSummary[]> {
    const store = SessionTreeStore.openSnapshot(this.vaultPath, sessionFile);
    return Promise.resolve(collectLeafSummaries(store.getTree(), store.getEntries()));
  }

  getMessages(ref: SessionRef): Promise<ChatMessage[]> {
    const store = SessionTreeStore.openSnapshot(
      this.vaultPath,
      ref.sessionFile,
    );
    const prefix = store.getLinearVisiblePrefix();
    const uiMap = collectMessageUiMap(store.getEntries());
    const messages = entriesToChatMessages(prefix, uiMap);
    const { skills } = loadRuntimeVaultSkills(this.vaultPath);
    return Promise.resolve(applySkillDescriptions(messages, skills));
  }

  getUsage(ref: SessionRef): Promise<UsageInfo | null> {
    const store = SessionTreeStore.openSnapshot(
      this.vaultPath,
      ref.sessionFile,
    );
    const messages = store.loadAgentMessages();
    for (let i = messages.length - 1; i >= 0; i--) {
      const usage = this.buildUsageInfo(messages[i]);
      if (usage) {
        return Promise.resolve(usage);
      }
    }
    return Promise.resolve(null);
  }

  private buildUsageInfo(message: AgentMessage | undefined): UsageInfo | null {
    const msg = message as unknown as Record<string, unknown> | undefined;
    if (!msg || msg.role !== "assistant") {
      return null;
    }
    const usage = this.getRecord(msg.usage);
    const inputTokens = this.getNumber(usage.input);
    const outputTokens = this.getNumber(usage.output);
    const cacheReadInputTokens = this.getNumber(usage.cacheRead) ?? 0;
    const cacheCreationInputTokens = this.getNumber(usage.cacheWrite) ?? 0;
    const contextTokens = inputTokens === null
      ? this.getNumber(usage.totalTokens)
      : inputTokens + cacheReadInputTokens + cacheCreationInputTokens;
    if (contextTokens === null || contextTokens <= 0) {
      return null;
    }

    const modelKey = typeof msg.provider === "string" && typeof msg.model === "string"
      ? `${msg.provider}/${msg.model}`
      : null;
    const model = modelKey ? resolvePiModelFromKeyWithLookup(modelKey, piAiModels) : null;
    const contextWindow = model?.contextWindow ?? 200_000;
    const outputTokenLimit = model?.maxTokens;
    return {
      cacheCreationInputTokens,
      cacheReadInputTokens,
      contextTokens,
      contextWindow,
      contextWindowIsAuthoritative: Boolean(model?.contextWindow),
      inputTokens: inputTokens ?? contextTokens,
      ...(modelKey ? { model: modelKey } : {}),
      ...(outputTokenLimit ? { outputTokenLimit } : {}),
      ...(outputTokens !== null ? { outputTokens } : {}),
      percentage: contextWindow > 0
        ? Math.min(100, Math.max(0, Math.round((contextTokens / contextWindow) * 100)))
        : 0,
    };
  }

  private getRecord(value: unknown): Record<string, unknown> {
    return value !== null && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown>
      : {};
  }

  private getNumber(value: unknown): number | null {
    return typeof value === "number" && Number.isFinite(value) ? value : null;
  }

  appendUserTurn(
    ref: SessionRef,
    prompt: string,
    ui?: UserTurnUi,
  ): Promise<SessionRef> {
    const store = SessionTreeStore.open(
      this.vaultPath,
      ref.sessionFile,
    );
    const entryId = store.appendUserMessage(prompt, ui?.images);
    if (ui?.displayContent || ui?.turnRequest) {
      store.appendMessageUi({
        targetEntryId: entryId,
        displayContent: ui.displayContent,
        turnRequest: ui.turnRequest,
      });
    }
    return Promise.resolve(this.refFromStore(store));
  }

  appendAgentTurn(
    ref: SessionRef,
    messages: PersistedAgentMessage[],
    ui?: MessageUiPatch[],
  ): Promise<SessionRef> {
    const store = SessionTreeStore.open(
      this.vaultPath,
      ref.sessionFile,
    );
    store.syncAgentMessages(messages as unknown as AgentMessage[]);
    if (ui) {
      for (const patch of ui) {
        store.appendMessageUi(patch);
      }
    }
    return Promise.resolve(this.refFromStore(store));
  }

  appendMessageUiPatches(ref: SessionRef, patches: MessageUiPatch[]): Promise<SessionRef> {
    const store = SessionTreeStore.open(
      this.vaultPath,
      ref.sessionFile,
    );
    const currentUiByEntryId = collectMessageUiMap(store.getEntries());
    for (const patch of patches) {
      const current = currentUiByEntryId.get(patch.targetEntryId) as MessageUiPatch | undefined;
      if (patchAlreadyPersisted(current, patch)) {
        continue;
      }
      store.appendMessageUi(patch);
      currentUiByEntryId.set(patch.targetEntryId, mergeMessageUiPatch(current, patch));
    }
    return Promise.resolve(this.refFromStore(store));
  }

  setLeaf(ref: SessionRef, leafId: string | null): Promise<SessionRef> {
    const store = SessionTreeStore.open(
      this.vaultPath,
      ref.sessionFile,
      ref.leafId,
    );
    if (!store.setLeaf(leafId)) {
      throw new Error(`Session leaf not found: ${leafId}`);
    }
    return Promise.resolve(this.refFromStore(store));
  }

  fork(ref: SessionRef, atEntryId: string): Promise<SessionRef> {
    const newFile = SessionTreeStore.forkFile(this.vaultPath, ref.sessionFile, atEntryId);
    if (!newFile) {
      throw new Error("Failed to fork session");
    }
    const forked = SessionTreeStore.open(this.vaultPath, newFile);
    return Promise.resolve(this.refFromStore(forked));
  }

  async deleteSession(sessionFile: string): Promise<void> {
    await this.adapter.delete(toVaultRelativePath(this.vaultPath, sessionFile));
  }

  readUiContext(ref: SessionRef): Promise<SessionUiContext> {
    const store = SessionTreeStore.openSnapshot(
      this.vaultPath,
      ref.sessionFile,
    );
    for (let i = store.getEntries().length - 1; i >= 0; i--) {
      const entry = store.getEntries()[i];
      if (entry.type !== "custom" || entry.customType !== PIVI_UI_CONTEXT) {
        continue;
      }
      const data = entry.data as PiviUiContextData | undefined;
      if (data) {
        return Promise.resolve({
          currentNote: data.currentNote,
          externalContextPaths: data.externalContextPaths,
          enabledMcpServers: data.enabledMcpServers,
        });
      }
    }
    return Promise.resolve({});
  }

  async writeUiContext(
    ref: SessionRef,
    patch: Partial<SessionUiContext>,
  ): Promise<void> {
    const store = SessionTreeStore.open(
      this.vaultPath,
      ref.sessionFile,
    );
    const current = await this.readUiContext(ref);
    const next = {
      currentNote: patch.currentNote ?? current.currentNote,
      externalContextPaths:
        patch.externalContextPaths ?? current.externalContextPaths,
      enabledMcpServers: patch.enabledMcpServers ?? current.enabledMcpServers,
    };
    if (uiContextEqual(current, next)) {
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
      titleGenerationStatus:
        patch.titleGenerationStatus ?? existing?.titleGenerationStatus,
      lastResponseAt: patch.lastResponseAt ?? existing?.lastResponseAt,
    };
    if (sessionMetaEqual(existing, next)) {
      return Promise.resolve();
    }
    store.appendCustomMeta(next);
    return Promise.resolve();
  }
}

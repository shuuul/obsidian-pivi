import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { SessionManager } from '@earendil-works/pi-coding-agent';
import { piAiModels } from '@pivi/pivi-agent-core/engine/pi/piAiModels';
import {
  isPiModelContextWindowAuthoritative,
  resolvePiModelFromKeyWithLookup,
} from '@pivi/pivi-agent-core/engine/pi/piModelRegistry';
import type { ChatMessage, UsageInfo } from '@pivi/pivi-agent-core/foundation';
import { sanitizeMessageUiForJsonl } from '@pivi/pivi-agent-core/session/messageUi';
import { getPiviSessionDir, toVaultRelativePath } from '@pivi/pivi-agent-core/session/sessionPaths';
import type {
  DeviceLocalExternalContextStore,
  FileStore,
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
  PIVI_MESSAGE_UI,
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
  for (const [index, value] of a.entries()) {
    const other = b[index];
    if (other === undefined || value !== other) {
      return false;
    }
  }
  return true;
}

interface ExternalContextJsonlMigration {
  content: string;
  changed: boolean;
  sessionPaths?: string[];
  turnPaths: Map<string, string[]>;
}

function externalPaths(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((path): path is string => typeof path === 'string')
    : [];
}

class ExternalContextJsonlMigrationError extends Error {}

/** Pure, line-preserving migration used by startup and lazy session opens. */
export function stripExternalContextsFromSessionJsonl(
  content: string,
  sessionFile: string,
): ExternalContextJsonlMigration {
  const hasFinalNewline = content.endsWith('\n');
  const lines = content.split('\n');
  if (hasFinalNewline) {
    lines.pop();
  }
  let changed = false;
  let sessionPaths: string[] | undefined;
  const turnPaths = new Map<string, string[]>();
  const migratedLines = lines.map((line, index) => {
    if (!line.trim()) {
      return line;
    }
    let parsed: Record<string, unknown>;
    try {
      const value: unknown = JSON.parse(line);
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return line;
      }
      parsed = value as Record<string, unknown>;
    } catch (error) {
      throw new ExternalContextJsonlMigrationError(
        `Failed to migrate external contexts in ${sessionFile} at line ${index + 1}`,
        { cause: error },
      );
    }
    if (parsed.type !== 'custom' || !parsed.data || typeof parsed.data !== 'object' || Array.isArray(parsed.data)) {
      return line;
    }
    const data = parsed.data as Record<string, unknown>;
    if (parsed.customType === PIVI_UI_CONTEXT && Object.hasOwn(data, 'externalContextPaths')) {
      sessionPaths = externalPaths(data.externalContextPaths);
      const nextData = { ...data };
      Reflect.deleteProperty(nextData, 'externalContextPaths');
      changed = true;
      return JSON.stringify({ ...parsed, data: nextData });
    }
    if (parsed.customType === PIVI_MESSAGE_UI && typeof data.targetEntryId === 'string') {
      const result = sanitizeMessageUiForJsonl(data);
      if (result.externalContextPaths) {
        turnPaths.set(data.targetEntryId, result.externalContextPaths);
        changed = true;
        return JSON.stringify({ ...parsed, data: result.sanitized });
      }
    }
    return line;
  });
  return {
    content: migratedLines.join('\n') + (hasFinalNewline ? '\n' : ''),
    changed,
    sessionPaths,
    turnPaths,
  };
}

class MemoryExternalContextStore implements DeviceLocalExternalContextStore {
  private readonly sessions = new Map<string, { selected: string[]; turns: Map<string, string[]> }>();
  private session(file: string) {
    let value = this.sessions.get(file);
    if (!value) {
      value = { selected: [], turns: new Map() };
      this.sessions.set(file, value);
    }
    return value;
  }
  getSessionPaths(file: string): string[] { return [...this.session(file).selected]; }
  setSessionPaths(file: string, paths: readonly string[]): void { this.session(file).selected = [...paths]; }
  getTurnPaths(file: string, entryId: string): string[] { return [...(this.session(file).turns.get(entryId) ?? [])]; }
  setTurnPaths(file: string, entryId: string, paths: readonly string[]): void { this.session(file).turns.set(entryId, [...paths]); }
  copySession(source: string, target: string): void {
    const current = this.session(source);
    this.sessions.set(target, {
      selected: [...current.selected],
      turns: new Map([...current.turns].map(([id, paths]) => [id, [...paths]])),
    });
  }
  deleteSession(file: string): void { this.sessions.delete(file); }
}

function sessionMetaEqual(
  a: PiviSessionMetaData | null | undefined,
  b: PiviSessionMetaData,
): boolean {
  return !!a
    && a.title === b.title
    && a.titleSource === b.titleSource
    && a.createdAt === b.createdAt
    && a.lastResponseAt === b.lastResponseAt;
}

export class PiSessionStore implements SessionStore {
  private readonly externalContexts: DeviceLocalExternalContextStore;

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
        console.warn(`Pivi: skipped malformed session migration: ${error.message}`);
      }
    }
    return migrated;
  }

  private async migrateSessionFile(sessionFile: string): Promise<boolean> {
    const content = await this.adapter.read(sessionFile);
    const migration = stripExternalContextsFromSessionJsonl(content, sessionFile);
    if (!migration.changed) {
      return false;
    }
    if (migration.sessionPaths !== undefined) {
      this.externalContexts.setSessionPaths(sessionFile, migration.sessionPaths);
    }
    for (const [entryId, paths] of migration.turnPaths) {
      this.externalContexts.setTurnPaths(sessionFile, entryId, paths);
    }
    await this.adapter.write(sessionFile, migration.content);
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

  async open(sessionFile: string): Promise<SessionRef> {
    await this.migrateSessionFileIfPresent(sessionFile);
    const store = SessionTreeStore.openSnapshot(this.vaultPath, sessionFile);
    return this.refFromStore(store);
  }

  async getMessages(ref: SessionRef): Promise<ChatMessage[]> {
    await this.migrateSessionFileIfPresent(ref.sessionFile);
    const store = SessionTreeStore.openSnapshot(
      this.vaultPath,
      ref.sessionFile,
    );
    const prefix = store.getLinearVisiblePrefix();
    const uiMap = collectMessageUiMap(store.getEntries());
    const messages = entriesToChatMessages(prefix, uiMap);
    for (const message of messages) {
      if (message.role !== 'user' || !message.userMessageId || !message.turnRequest) {
        continue;
      }
      const paths = this.externalContexts.getTurnPaths(ref.sessionFile, message.userMessageId);
      if (paths.length > 0) {
        message.turnRequest = { ...message.turnRequest, externalContextPaths: paths };
      }
    }
    const { skills } = loadRuntimeVaultSkills(this.vaultPath);
    return applySkillDescriptions(messages, skills);
  }

  getUsage(ref: SessionRef): Promise<UsageInfo | null> {
    const store = SessionTreeStore.openSnapshot(
      this.vaultPath,
      ref.sessionFile,
    );
    const messages = store.loadAgentMessages();
    for (let i = messages.length - 1; i >= 0; i--) {
      const message = messages[i];
      if (!message) {
        continue;
      }
      const usage = this.buildUsageInfo(message);
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
    const contextWindow = model?.contextWindow ?? 0;
    const outputTokenLimit = model?.maxTokens;
    return {
      cacheCreationInputTokens,
      cacheReadInputTokens,
      contextTokens,
      contextWindow,
      contextWindowIsAuthoritative: isPiModelContextWindowAuthoritative(model),
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
    const sanitizedUi = ui ? sanitizeMessageUiForJsonl(ui) : undefined;
    if (sanitizedUi?.externalContextPaths) {
      this.externalContexts.setTurnPaths(ref.sessionFile, entryId, sanitizedUi.externalContextPaths);
    }
    if (sanitizedUi?.sanitized.displayContent || sanitizedUi?.sanitized.turnRequest) {
      store.appendMessageUi({
        targetEntryId: entryId,
        displayContent: sanitizedUi.sanitized.displayContent,
        turnRequest: sanitizedUi.sanitized.turnRequest,
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
        const result = sanitizeMessageUiForJsonl(patch);
        if (result.externalContextPaths) {
          this.externalContexts.setTurnPaths(ref.sessionFile, patch.targetEntryId, result.externalContextPaths);
        }
        store.appendMessageUi(result.sanitized);
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
    this.externalContexts.deleteSession(relativePath);
  }

  readUiContext(ref: SessionRef): Promise<SessionUiContext> {
    const store = SessionTreeStore.openSnapshot(
      this.vaultPath,
      ref.sessionFile,
    );
    const entries = store.getEntries();
    for (let i = entries.length - 1; i >= 0; i--) {
      const entry = entries[i];
      if (!entry) {
        continue;
      }
      if (entry.type !== "custom" || entry.customType !== PIVI_UI_CONTEXT) {
        continue;
      }
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
    const current = await this.readUiContext(ref);
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

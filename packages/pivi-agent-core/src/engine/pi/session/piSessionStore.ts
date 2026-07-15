import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { SessionEntry } from '@earendil-works/pi-coding-agent';

import type { ChatMessage, UsageInfo } from '../../../foundation';
import { PluginLogger } from '../../../foundation/pluginLogger';
import { sanitizeMessageUiForJsonl } from '../../../session/messageUi';
import {
  getPiviSessionDir,
  toAbsoluteSessionPath,
  toVaultRelativePath,
} from '../../../session/sessionPaths';
import type {
  DeviceLocalExternalContextStore,
  FileStore,
  MessageUiPatch,
  PersistedAgentMessage,
  SessionMessagePage,
  SessionMetaPatch,
  SessionRef,
  SessionStore,
  SessionUiContext,
  StoreSessionInfo,
  UserTurnUi,
} from '../../../session/types';
import {
  PIVI_MESSAGE_UI,
  PIVI_SESSION_META,
  PIVI_UI_CONTEXT,
  type PiviSessionMetaData,
  type PiviUiContextData,
  SessionIndexCorruptError,
  SessionIndexError,
} from '../../../session/types';
import { loadRuntimeVaultSkills } from '../../../skills/vault/loadVaultSkills';
import { piAiModels } from '../piAiModels';
import {
  isPiModelContextWindowAuthoritative,
  resolvePiModelFromKeyWithLookup,
} from '../piModelRegistry';
import {
  applySkillDescriptions,
  collectMessageUiMap,
  entriesToChatMessages,
  firstUserMessagePreview,
  readSessionMetaFromBranch,
} from './messageMapper';
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

const logger = new PluginLogger('PiSessionStore');

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
    const summaries: StoreSessionInfo[] = [];
    let files: string[] = [];
    try {
      files = readdirSync(sessionDir)
        .filter(file => file.endsWith('.jsonl'))
        .map(file => join(sessionDir, file));
    } catch {
      return summaries;
    }
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
        const updatedAt = meta?.lastResponseAt ?? statSync(absoluteFile).mtimeMs;
        summaries.push({
          sessionFile,
          sessionId: index.header.id,
          title: meta?.title || messagePreview,
          ...(meta?.titleSource ? { titleSource: meta.titleSource } : {}),
          updatedAt,
          leafCount: 1,
          messagePreview,
          messageCount: range.totalMessageCount,
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
    const index = readSessionJsonlIndex(toAbsoluteSessionPath(this.vaultPath, relativeFile));
    return {
      sessionFile: relativeFile,
      sessionId: index.header.id,
    };
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
    return this.applyMessageReadOverlays(messages, ref.sessionFile);
  }

  async openRecent(ref: SessionRef, limit: number): Promise<SessionMessagePage> {
    await this.migrateSessionFileIfPresent(ref.sessionFile);
    const result = openRecentSessionJsonlMessages(
      toAbsoluteSessionPath(this.vaultPath, ref.sessionFile),
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
      toAbsoluteSessionPath(this.vaultPath, ref.sessionFile),
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
      const usage = this.buildUsageInfo(entry.message as AgentMessage | undefined);
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
    invalidateSessionJsonlIndex(toAbsoluteSessionPath(this.vaultPath, relativePath));
    this.externalContexts.deleteSession(relativePath);
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

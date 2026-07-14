import type { ChatMessage, OpenSessionState, SessionSummary, ToolCallInfo } from '../foundation';
import { PluginLogger } from '../foundation/pluginLogger';
import type { MessageUiPatch, SessionStore } from './types';

const logger = new PluginLogger('OpenSessionManager');

export interface OpenSessionManagerDeps {
  getVaultPath(): string | null;
  getStore(): SessionStore;
}

function cloneToolCallForUi(toolCall: ToolCallInfo): ToolCallInfo {
  return JSON.parse(JSON.stringify(toolCall)) as ToolCallInfo;
}

function buildMessageUiPatch(message: ChatMessage): MessageUiPatch | null {
  const targetEntryId = message.role === 'assistant'
    ? message.assistantMessageId
    : message.userMessageId;
  if (!targetEntryId) {
    return null;
  }

  const patch: MessageUiPatch = { targetEntryId };
  if (message.role === 'user') {
    if (message.displayContent !== undefined) {
      patch.displayContent = message.displayContent;
    }
    if (message.turnRequest) {
      patch.turnRequest = message.turnRequest;
    }
    patch.userMessageId = targetEntryId;
    return patch.displayContent !== undefined || patch.turnRequest ? patch : null;
  }

  if (message.contentBlocks?.length) {
    patch.contentBlocks = message.contentBlocks;
  }
  if (message.toolCalls?.length) {
    patch.toolCalls = message.toolCalls.map(cloneToolCallForUi);
  }
  if (message.durationSeconds !== undefined) {
    patch.durationSeconds = message.durationSeconds;
  }
  if (message.durationFlavorWord) {
    patch.durationFlavorWord = message.durationFlavorWord;
  }
  patch.assistantMessageId = targetEntryId;

  return patch.contentBlocks || patch.toolCalls || patch.durationSeconds !== undefined || patch.durationFlavorWord
    ? patch
    : null;
}

function markRestoredRunningAsyncSubagentsOrphaned(messages: ChatMessage[]): boolean {
  let changed = false;
  for (const message of messages) {
    if (message.role !== 'assistant' || !message.toolCalls?.length) {
      continue;
    }
    for (const toolCall of message.toolCalls) {
      const subagent = toolCall.subagent;
      if (!subagent || subagent.mode !== 'async') {
        continue;
      }
      const status = subagent.asyncStatus ?? subagent.status;
      if (status !== 'pending' && status !== 'running') {
        continue;
      }

      const fallback = 'Session ended before task completed';
      const preservedResult = subagent.result?.trim() || toolCall.result?.trim() || fallback;
      subagent.asyncStatus = 'orphaned';
      subagent.status = 'error';
      subagent.result = preservedResult;
      subagent.completedAt = subagent.completedAt ?? Date.now();
      toolCall.status = 'error';
      toolCall.result = preservedResult;
      changed = true;
    }
  }
  return changed;
}

export class OpenSessionManager {
  private sessions: OpenSessionState[] = [];

  constructor(private readonly deps: OpenSessionManagerDeps) {}

  getAll(): OpenSessionState[] {
    return this.sessions;
  }

  replaceAll(sessions: OpenSessionState[]): void {
    this.sessions = sessions;
  }

  async loadSummaries(): Promise<void> {
    const vaultPath = this.deps.getVaultPath();
    if (!vaultPath) {
      this.sessions = [];
      return;
    }

    const summaries = await this.deps.getStore().listSessions(vaultPath);
    this.sessions = summaries.map((summary) => ({
      id: summary.sessionId,
      title: summary.title,
      createdAt: summary.updatedAt,
      updatedAt: summary.updatedAt,
      lastResponseAt: summary.updatedAt,
      sessionId: summary.sessionId,
      sessionFile: summary.sessionFile,
      leafId: null,
      leafCount: 1,
      messages: [],
      titleSource: summary.titleSource,
    }));
  }

  backfillSessionResponseTimestamps(): OpenSessionState[] {
    const updated: OpenSessionState[] = [];
    for (const openSession of this.sessions) {
      if (openSession.lastResponseAt != null) continue;
      if (!openSession.messages || openSession.messages.length === 0) continue;

      for (let i = openSession.messages.length - 1; i >= 0; i--) {
        const msg = openSession.messages[i];
        if (!msg) {
          continue;
        }
        if (msg.role === 'assistant') {
          openSession.lastResponseAt = msg.timestamp;
          updated.push(openSession);
          break;
        }
      }
    }
    return updated;
  }

  async persistSessionSummary(openSession: OpenSessionState): Promise<void> {
    if (!openSession.sessionFile) {
      return;
    }
    try {
      const store = this.deps.getStore();
      const ref = await store.open(openSession.sessionFile);
      await store.writeSessionMeta(ref, {
        title: openSession.title,
        titleSource: openSession.titleSource,
        lastResponseAt: openSession.lastResponseAt,
        createdAt: openSession.createdAt,
      });
      openSession.leafId = null;
      await store.writeUiContext(ref, {
        currentNote: openSession.currentNote,
        externalContextPaths: openSession.externalContextPaths,
        enabledMcpServers: openSession.enabledMcpServers,
      });
      openSession.leafCount = 1;
    } catch (error) {
      logger.error('Failed to persist session metadata', error);
    }
  }

  private async persistMessageUiPatches(openSession: OpenSessionState): Promise<void> {
    if (!openSession.sessionFile) {
      return;
    }
    const store = this.deps.getStore();
    if (!store.appendMessageUiPatches) {
      return;
    }
    const ref = store.sessionRefFromOpenSession(openSession);
    if (!ref) {
      return;
    }
    const patches = openSession.messages
      .map(buildMessageUiPatch)
      .filter((patch): patch is MessageUiPatch => patch !== null);
    if (patches.length === 0) {
      return;
    }
    try {
      await store.appendMessageUiPatches(ref, patches);
    } catch (error) {
      logger.warn('failed to persist message UI overlays', error);
    }
  }

  async hydrate(openSession: OpenSessionState): Promise<void> {
    const store = this.deps.getStore();
    if (!openSession.sessionFile) {
      return;
    }

    const ref = store.sessionRefFromOpenSession(openSession);
    if (!ref) {
      return;
    }

    const opened = await store.open(ref.sessionFile);
    openSession.messages = await store.getMessages(opened);
    openSession.usage = await store.getUsage?.(opened) ?? openSession.usage;
    openSession.sessionId = opened.sessionId;
    openSession.leafId = null;
    openSession.leafCount = 1;
    openSession.sessionFile = opened.sessionFile;

    const uiContext = await store.readUiContext(opened);
    openSession.currentNote = uiContext.currentNote;
    openSession.externalContextPaths = uiContext.externalContextPaths;
    openSession.enabledMcpServers = uiContext.enabledMcpServers;
    if (markRestoredRunningAsyncSubagentsOrphaned(openSession.messages)) {
      await this.persistMessageUiPatches(openSession);
    }
  }

  async create(options?: {
    sessionId?: string;
    sessionFile?: string;
  }): Promise<OpenSessionState> {
    const vaultPath = this.deps.getVaultPath();
    if (!vaultPath) {
      throw new Error('Vault path unavailable');
    }

    let sessionFile = options?.sessionFile;
    let sessionId = options?.sessionId ?? null;
    const attachingExistingFile = !!sessionFile;
    let title = this.generateDefaultTitle();
    let titleSource: OpenSessionState['titleSource'] = 'timestamp';
    let createdAt = Date.now();
    let updatedAt = createdAt;

    if (!sessionFile) {
      const ref = await this.deps.getStore().create(vaultPath);
      sessionFile = ref.sessionFile;
      sessionId = ref.sessionId;
      await this.deps.getStore().writeSessionMeta(ref, {
        title,
        titleSource: 'timestamp',
        createdAt,
      });
    }

    const existing = this.sessions.find((candidate) => candidate.sessionFile === sessionFile);
    if (existing) {
      return existing;
    }

    // Existing JSONL files already have durable meta (title/titleSource).
    // Never invent timestamp defaults and write them back over real meta.
    if (attachingExistingFile && sessionFile) {
      try {
        const match = (await this.deps.getStore().listSessions(vaultPath))
          .find((summary) => summary.sessionFile === sessionFile);
        if (match) {
          title = match.title;
          titleSource = match.titleSource ?? titleSource;
          createdAt = match.updatedAt;
          updatedAt = match.updatedAt;
          sessionId = sessionId ?? match.sessionId;
        }
      } catch {
        // Fall back to in-memory defaults; still avoid overwriting disk meta below.
      }
    }

    const openSession: OpenSessionState = {
      id: sessionId ?? this.generateOpenSessionId(),
      title,
      createdAt,
      updatedAt,
      lastResponseAt: undefined,
      sessionId,
      sessionFile,
      leafId: null,
      leafCount: 1,
      messages: [],
      titleSource,
    };

    this.sessions.unshift(openSession);
    if (!attachingExistingFile) {
      await this.persistSessionSummary(openSession);
    }

    return openSession;
  }

  async openByFile(sessionFile: string): Promise<OpenSessionState> {
    const vaultPath = this.deps.getVaultPath();
    if (!vaultPath) {
      throw new Error('Vault path unavailable');
    }

    let openSession = this.sessions.find((candidate) => candidate.sessionFile === sessionFile);
    if (!openSession) {
      const opened = await this.deps.getStore().open(sessionFile);
      openSession = await this.create({
        sessionFile: opened.sessionFile,
        sessionId: opened.sessionId,
      });
    }

    await this.hydrate(openSession);
    return openSession;
  }

  async switch(id: string): Promise<OpenSessionState | null> {
    const openSession = this.sessions.find((candidate) => candidate.id === id);
    if (!openSession) return null;

    await this.hydrate(openSession);
    return openSession;
  }

  async delete(id: string): Promise<OpenSessionState | null> {
    const index = this.sessions.findIndex((candidate) => candidate.id === id);
    if (index === -1) return null;

    const [openSession] = this.sessions.splice(index, 1);
    return openSession ?? null;
  }

  async rename(id: string, title: string, titleSource?: OpenSessionState['titleSource']): Promise<void> {
    const openSession = this.getSync(id);
    if (!openSession) return;

    openSession.title = title.trim() || this.generateDefaultTitle();
    openSession.titleSource = titleSource ?? openSession.titleSource;
    openSession.updatedAt = Date.now();
    await this.persistSessionSummary(openSession);
  }

  async update(id: string, updates: Partial<OpenSessionState>): Promise<void> {
    const openSession = this.getSync(id);
    if (!openSession) return;

    Object.assign(openSession, updates, { updatedAt: Date.now() });
    await this.persistSessionSummary(openSession);
    if (updates.messages) {
      await this.persistMessageUiPatches(openSession);
    }

    for (const msg of openSession.messages) {
      if (msg.images) {
        for (const img of msg.images) {
          img.data = '';
        }
      }
    }
  }

  async getById(id: string): Promise<OpenSessionState | null> {
    const openSession = this.getSync(id);
    if (openSession) {
      await this.hydrate(openSession);
    }
    return openSession;
  }

  getSync(id: string): OpenSessionState | null {
    return this.sessions.find((candidate) => candidate.id === id) || null;
  }

  findEmpty(): OpenSessionState | null {
    return this.sessions.find((candidate) => candidate.messages.length === 0) || null;
  }

  list(): SessionSummary[] {
    return this.sessions.map((openSession) => ({
      id: openSession.id,
      title: openSession.title,
      createdAt: openSession.createdAt,
      updatedAt: openSession.updatedAt,
      lastResponseAt: openSession.lastResponseAt,
      messageCount: openSession.messages.length,
      preview: this.getPreview(openSession),
      titleSource: openSession.titleSource,
      sessionFile: openSession.sessionFile,
      leafCount: 1,
    }));
  }

  private getPreview(openSession: OpenSessionState): string {
    const firstUserMsg = openSession.messages.find((message) => message.role === 'user');
    if (!firstUserMsg) {
      return 'New session';
    }
    return firstUserMsg.content.substring(0, 50) + (firstUserMsg.content.length > 50 ? '...' : '');
  }

  private generateOpenSessionId(): string {
    return `conv-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
  }

  private generateDefaultTitle(): string {
    const now = new Date();
    return now.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }
}

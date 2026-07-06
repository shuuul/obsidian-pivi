import type { OpenSessionState, SessionSummary } from '@pivi/pivi-agent-core/foundation';

import type { SessionStore } from './types';

export interface OpenSessionManagerDeps {
  getVaultPath(): string | null;
  getStore(): SessionStore;
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
      titleGenerationStatus: undefined,
    }));
  }

  backfillSessionResponseTimestamps(): OpenSessionState[] {
    const updated: OpenSessionState[] = [];
    for (const openSession of this.sessions) {
      if (openSession.lastResponseAt != null) continue;
      if (!openSession.messages || openSession.messages.length === 0) continue;

      for (let i = openSession.messages.length - 1; i >= 0; i--) {
        const msg = openSession.messages[i];
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
        titleGenerationStatus: openSession.titleGenerationStatus,
        lastResponseAt: openSession.lastResponseAt,
        createdAt: openSession.createdAt,
      });
      openSession.leafId = null;
      await store.writeUiContext(ref, {
        currentNote: openSession.currentNote,
        externalContextPaths: openSession.externalContextPaths,
        enabledMcpServers: openSession.enabledMcpServers,
      });
      openSession.leafId = null;
      openSession.leafCount = 1;
    } catch (error) {
      console.error('Pivi: failed to persist session metadata', error);
    }
  }

  async hydrate(openSession: OpenSessionState, _leafId?: string | null): Promise<void> {
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
  }

  async create(options?: {
    sessionId?: string;
    sessionFile?: string;
    leafId?: string | null;
  }): Promise<OpenSessionState> {
    const vaultPath = this.deps.getVaultPath();
    if (!vaultPath) {
      throw new Error('Vault path unavailable');
    }

    let sessionFile = options?.sessionFile;
    let sessionId = options?.sessionId ?? null;

    if (!sessionFile) {
      const ref = await this.deps.getStore().create(vaultPath);
      sessionFile = ref.sessionFile;
      sessionId = ref.sessionId;
      await this.deps.getStore().writeSessionMeta(ref, {
        title: this.generateDefaultTitle(),
        createdAt: Date.now(),
      });
    }

    const existing = this.sessions.find((candidate) => candidate.sessionFile === sessionFile);
    if (existing) {
      return existing;
    }

    const openSession: OpenSessionState = {
      id: sessionId ?? this.generateOpenSessionId(),
      title: this.generateDefaultTitle(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
      lastResponseAt: undefined,
      sessionId,
      sessionFile,
      leafId: null,
      leafCount: 1,
      messages: [],
    };

    this.sessions.unshift(openSession);
    await this.persistSessionSummary(openSession);

    return openSession;
  }

  async openByFile(sessionFile: string, leafId?: string | null): Promise<OpenSessionState> {
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

  async switch(id: string, _leafId?: string | null): Promise<OpenSessionState | null> {
    const openSession = this.sessions.find((candidate) => candidate.id === id);
    if (!openSession) return null;

    await this.hydrate(openSession);
    return openSession;
  }

  async delete(id: string): Promise<OpenSessionState | null> {
    const index = this.sessions.findIndex((candidate) => candidate.id === id);
    if (index === -1) return null;

    const [openSession] = this.sessions.splice(index, 1);
    return openSession;
  }

  async rename(id: string, title: string): Promise<void> {
    const openSession = this.getSync(id);
    if (!openSession) return;

    openSession.title = title.trim() || this.generateDefaultTitle();
    openSession.updatedAt = Date.now();
    await this.persistSessionSummary(openSession);
  }

  async update(id: string, updates: Partial<OpenSessionState>): Promise<void> {
    const openSession = this.getSync(id);
    if (!openSession) return;

    Object.assign(openSession, updates, { updatedAt: Date.now() });
    await this.persistSessionSummary(openSession);

    for (const msg of openSession.messages) {
      if (msg.images) {
        for (const img of msg.images) {
          img.data = '';
        }
      }
    }
  }

  async getById(id: string, _leafId?: string | null): Promise<OpenSessionState | null> {
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
      titleGenerationStatus: openSession.titleGenerationStatus,
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

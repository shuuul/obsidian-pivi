export class SessionManager {
  private leafId: string | null = 'leaf-1';
  private sessionFile = '/tmp/mock-session.jsonl';
  private nextEntryNumber = 1;
  private readonly entries: Array<{
    id: string;
    type: string;
    message?: unknown;
    customType?: string;
    data?: unknown;
  }> = [{ id: 'leaf-1', type: 'root' }];
  private readonly knownEntries = new Set(['leaf-1', 'entry-1']);

  static create(): SessionManager {
    return new SessionManager();
  }
  static open(): SessionManager {
    return new SessionManager();
  }
  static inMemory(): SessionManager {
    return new SessionManager();
  }
  static async list(): Promise<Array<{ path: string; id: string; modified: Date; firstMessage: string }>> {
    return [];
  }

  isPersisted(): boolean {
    return false;
  }

  _rewriteFile(): void {}

  getSessionFile(): string {
    return this.sessionFile;
  }
  getSessionId(): string {
    return 'mock-session-id';
  }
  getLeafId(): string | null {
    return this.leafId;
  }
  getEntry(id: string): { id: string } | undefined {
    return this.knownEntries.has(id) ? { id } : undefined;
  }
  branch(branchFromId: string): void {
    if (!this.knownEntries.has(branchFromId)) {
      throw new Error(`Entry ${branchFromId} not found`);
    }
    this.leafId = branchFromId;
  }
  buildSessionContext(): { messages: unknown[] } {
    return {
      messages: this.entries
        .filter((entry) => entry.type === 'message')
        .map((entry) => entry.message),
    };
  }
  appendMessage(message: unknown): string {
    const id = `entry-${this.nextEntryNumber++}`;
    this.knownEntries.add(id);
    this.entries.push({ id, type: 'message', message });
    this.leafId = id;
    return id;
  }
  appendCustomEntry(customType: string, data: unknown): string {
    const id = `custom-${this.nextEntryNumber++}`;
    this.knownEntries.add(id);
    this.entries.push({ id, type: 'custom', customType, data });
    this.leafId = id;
    return id;
  }
  createBranchedSession(): string {
    return '/tmp/mock-fork.jsonl';
  }
  getEntries(): unknown[] {
    return [...this.entries];
  }
  getBranch(): unknown[] {
    return [...this.entries];
  }
  getTree(): unknown[] {
    return [];
  }
}

export function buildSessionContext(): { messages: unknown[] } {
  return { messages: [] };
}

export function loadSkillsFromDir(): { skills: []; diagnostics: [] } {
  return { skills: [], diagnostics: [] };
}

export function formatSkillsForPrompt(): string {
  return '';
}

export class AuthStorage {
  static create(): AuthStorage {
    return new AuthStorage();
  }
  hasAuth(): boolean {
    return false;
  }
  async getApiKey(): Promise<string | undefined> {
    return undefined;
  }
  async login(): Promise<void> {}
  logout(): void {}
}

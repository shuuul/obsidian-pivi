export class SessionManager {
  private leafId: string | null = 'leaf-1';
  private sessionFile = '/tmp/mock-session.jsonl';
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
    return { messages: [] };
  }
  appendMessage(): string {
    return 'entry-1';
  }
  appendCustomEntry(): string {
    return 'custom-1';
  }
  createBranchedSession(): string {
    return '/tmp/mock-fork.jsonl';
  }
  getEntries(): unknown[] {
    return [];
  }
  getBranch(): unknown[] {
    return [];
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

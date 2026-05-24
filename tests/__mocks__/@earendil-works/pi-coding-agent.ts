export class SessionManager {
  static create(): SessionManager {
    return new SessionManager();
  }
  static open(): SessionManager {
    return new SessionManager();
  }
  static inMemory(): SessionManager {
    return new SessionManager();
  }
  getSessionFile(): string {
    return '/tmp/mock-session.jsonl';
  }
  getSessionId(): string {
    return 'mock-session-id';
  }
  getLeafId(): string | null {
    return 'leaf-1';
  }
  buildSessionContext(): { messages: unknown[] } {
    return { messages: [] };
  }
  appendMessage(): string {
    return 'entry-1';
  }
  createBranchedSession(): string {
    return '/tmp/mock-fork.jsonl';
  }
  getEntries(): unknown[] {
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

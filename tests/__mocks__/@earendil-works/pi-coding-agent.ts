interface MockSessionEntry {
  id: string;
  parentId: string | null;
  timestamp: string;
  type: string;
  message?: unknown;
  customType?: string;
  data?: unknown;
  summary?: string;
  firstKeptEntryId?: string;
  tokensBefore?: number;
}

interface MockSessionHeader {
  type: 'session';
  id: string;
  timestamp: string;
  cwd: string;
}

function buildContextFromEntries(entries: MockSessionEntry[], leafId?: string | null): { messages: unknown[] } {
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  let path = entries;
  if (leafId !== undefined) {
    if (leafId === null) {
      return { messages: [] };
    }
    const branch: MockSessionEntry[] = [];
    let current = byId.get(leafId);
    while (current) {
      branch.push(current);
      current = current.parentId ? byId.get(current.parentId) : undefined;
    }
    path = branch.reverse();
  }

  let compaction: MockSessionEntry | undefined;
  for (let i = path.length - 1; i >= 0; i--) {
    if (path[i].type === 'compaction') {
      compaction = path[i];
      break;
    }
  }
  if (!compaction) {
    return {
      messages: path
        .filter((entry) => entry.type === 'message')
        .map((entry) => entry.message),
    };
  }

  const compactionIndex = path.findIndex((entry) => entry.id === compaction.id);
  const messages: unknown[] = [{
    role: 'compactionSummary',
    summary: compaction.summary,
    timestamp: Date.parse(compaction.timestamp),
  }];
  let foundFirstKept = false;
  for (let i = 0; i < compactionIndex; i++) {
    const entry = path[i];
    if (entry.id === compaction.firstKeptEntryId) {
      foundFirstKept = true;
    }
    if (foundFirstKept && entry.type === 'message') {
      messages.push(entry.message);
    }
  }
  for (let i = compactionIndex + 1; i < path.length; i++) {
    const entry = path[i];
    if (entry.type === 'message') {
      messages.push(entry.message);
    }
  }
  return { messages };
}

export class SessionManager {
  private leafId: string | null = null;
  private sessionFile = '/tmp/mock-session.jsonl';
  private nextEntryNumber = 1;
  private readonly header: MockSessionHeader = {
    type: 'session',
    id: 'mock-session-id',
    timestamp: new Date(0).toISOString(),
    cwd: '/test',
  };
  private readonly entries: MockSessionEntry[] = [];
  private readonly knownEntries = new Set(['leaf-1', 'entry-1']);

  get fileEntries(): Array<MockSessionHeader | MockSessionEntry> {
    return [this.header, ...this.entries];
  }

  set fileEntries(entries: Array<MockSessionHeader | MockSessionEntry>) {
    this.entries.splice(
      0,
      this.entries.length,
      ...entries.filter((entry): entry is MockSessionEntry => entry.type !== 'session'),
    );
  }

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

  _buildIndex(): void {
    this.knownEntries.clear();
    this.knownEntries.add('leaf-1');
    this.knownEntries.add('entry-1');
    this.leafId = null;
    for (const entry of this.entries) {
      this.knownEntries.add(entry.id);
      this.leafId = entry.id;
    }
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
  resetLeaf(): void {
    this.leafId = null;
  }
  buildSessionContext(): { messages: unknown[] } {
    return buildContextFromEntries(this.entries, this.leafId);
  }
  appendMessage(message: unknown): string {
    const id = `entry-${this.nextEntryNumber++}`;
    this.knownEntries.add(id);
    this.entries.push({
      id,
      parentId: this.leafId,
      timestamp: new Date(this.nextEntryNumber).toISOString(),
      type: 'message',
      message,
    });
    this.leafId = id;
    return id;
  }
  appendCustomEntry(customType: string, data: unknown): string {
    const id = `custom-${this.nextEntryNumber++}`;
    this.knownEntries.add(id);
    this.entries.push({
      id,
      parentId: this.leafId,
      timestamp: new Date(this.nextEntryNumber).toISOString(),
      type: 'custom',
      customType,
      data,
    });
    this.leafId = id;
    return id;
  }
  appendCompaction(summary: string, firstKeptEntryId: string, tokensBefore: number): string {
    const id = `compaction-${this.nextEntryNumber++}`;
    this.knownEntries.add(id);
    this.entries.push({
      id,
      parentId: this.leafId,
      timestamp: new Date(this.nextEntryNumber).toISOString(),
      type: 'compaction',
      summary,
      firstKeptEntryId,
      tokensBefore,
    });
    this.leafId = id;
    return id;
  }
  createBranchedSession(): string {
    return '/tmp/mock-fork.jsonl';
  }
  getEntries(): unknown[] {
    return [...this.entries];
  }
  private getBranchEntries(fromId?: string): MockSessionEntry[] {
    const byId = new Map(this.entries.map((entry) => [entry.id, entry]));
    const path: MockSessionEntry[] = [];
    let current = byId.get(fromId ?? this.leafId ?? '');
    while (current) {
      path.push(current);
      current = current.parentId ? byId.get(current.parentId) : undefined;
    }
    return path.reverse();
  }
  getBranch(fromId?: string): unknown[] {
    return this.getBranchEntries(fromId);
  }
  getTree(): unknown[] {
    const nodeById = new Map<string, { entry: unknown; children: unknown[] }>();
    const roots: Array<{ entry: unknown; children: unknown[] }> = [];
    for (const entry of this.entries) {
      nodeById.set(entry.id, { entry, children: [] });
    }
    for (const entry of this.entries) {
      const node = nodeById.get(entry.id)!;
      const parent = entry.parentId ? nodeById.get(entry.parentId) : undefined;
      if (parent) {
        parent.children.push(node);
      } else {
        roots.push(node);
      }
    }
    return roots;
  }
}

export function buildSessionContext(entries: MockSessionEntry[], leafId?: string | null): { messages: unknown[] } {
  return buildContextFromEntries(entries, leafId);
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

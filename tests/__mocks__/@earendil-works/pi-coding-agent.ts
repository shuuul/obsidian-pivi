interface MockSessionEntry {
  id: string;
  parentId: string | null;
  timestamp: string;
  type: string;
  message?: unknown;
  customType?: string;
  content?: unknown;
  display?: boolean;
  fromId?: string;
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

export const CURRENT_SESSION_VERSION = 3;

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
    const entry = path[i];
    if (entry?.type === 'compaction') {
      compaction = entry;
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
    if (!entry) continue;
    if (entry.id === compaction.firstKeptEntryId) {
      foundFirstKept = true;
    }
    if (foundFirstKept && entry.type === 'message') {
      messages.push(entry.message);
    }
  }
  for (let i = compactionIndex + 1; i < path.length; i++) {
    const entry = path[i];
    if (!entry) continue;
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
  appendCompaction(
    summary: string,
    firstKeptEntryId: string,
    tokensBefore: number,
    details?: unknown,
    fromHook?: boolean,
  ): string {
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
      ...(details === undefined ? {} : { details }),
      ...(fromHook === undefined ? {} : { fromHook }),
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

export function buildContextEntries(entries: MockSessionEntry[]): MockSessionEntry[] {
  let compactionIndex = -1;
  for (let index = entries.length - 1; index >= 0; index--) {
    if (entries[index]?.type === 'compaction') {
      compactionIndex = index;
      break;
    }
  }
  if (compactionIndex < 0) return [...entries];
  const compaction = entries[compactionIndex]!;
  const firstKeptIndex = entries.findIndex((entry) => entry.id === compaction.firstKeptEntryId);
  return [
    compaction,
    ...(firstKeptIndex >= 0 ? entries.slice(firstKeptIndex, compactionIndex) : []),
    ...entries.slice(compactionIndex + 1),
  ];
}

export function sessionEntryToContextMessages(entry: MockSessionEntry): unknown[] {
  if (entry.type === 'message') return [entry.message];
  if (entry.type === 'compaction') {
    return [{
      role: 'user',
      content: [{
        type: 'text',
        text: `<context_compaction_summary>\n${entry.summary ?? ''}\n</context_compaction_summary>`,
      }],
    }];
  }
  if (entry.type === 'custom_message') {
    return [{
      role: 'custom',
      customType: entry.customType,
      content: entry.content,
      display: entry.display,
    }];
  }
  if (entry.type === 'branch_summary') {
    return [{
      role: 'branchSummary',
      summary: entry.summary ?? '',
      fromId: entry.fromId,
    }];
  }
  return [];
}

export function estimateTokens(message: unknown): number {
  return Math.max(1, Math.ceil(JSON.stringify(message).length / 4));
}

export function findCutPoint(
  entries: MockSessionEntry[],
  startIndex: number,
  endIndex: number,
  keepRecentTokens: number,
): { firstKeptEntryIndex: number; turnStartIndex: number; isSplitTurn: boolean } {
  const valid = entries.map((entry, index) => ({ entry, index }))
    .filter(({ entry, index }) => (
      index >= startIndex
      && index < endIndex
      && entry.type === 'message'
      && (entry.message as { role?: string } | undefined)?.role !== 'toolResult'
    ))
    .map(({ index }) => index);
  let cutIndex = valid[0] ?? startIndex;
  let accumulated = 0;
  for (let index = endIndex - 1; index >= startIndex; index--) {
    accumulated += sessionEntryToContextMessages(entries[index]!)
      .reduce<number>((total, message) => total + estimateTokens(message), 0);
    if (accumulated >= keepRecentTokens) {
      cutIndex = valid.find((candidate) => candidate >= index) ?? cutIndex;
      break;
    }
  }
  const role = (entries[cutIndex]?.message as { role?: string } | undefined)?.role;
  let turnStartIndex = -1;
  if (role !== 'user') {
    for (let index = cutIndex - 1; index >= startIndex; index--) {
      if ((entries[index]?.message as { role?: string } | undefined)?.role === 'user') {
        turnStartIndex = index;
        break;
      }
    }
  }
  return {
    firstKeptEntryIndex: cutIndex,
    turnStartIndex,
    isSplitTurn: role !== 'user' && turnStartIndex >= 0,
  };
}

export function convertToLlm(messages: unknown[]): unknown[] {
  return messages;
}

export function serializeConversation(messages: unknown[]): string {
  return messages.map((message) => {
    const record = message as { role?: string; content?: unknown };
    const label = record.role === 'toolResult'
      ? 'Tool result'
      : record.role === 'assistant' ? 'Assistant' : 'User';
    const content = typeof record.content === 'string'
      ? record.content
      : (record.content as Array<Record<string, unknown>> | undefined)?.map((part) => {
          if (part.type === 'text') return part.text;
          if (part.type === 'thinking') return `[Assistant thinking]: ${String(part.thinking)}`;
          if (part.type === 'toolCall') return `[Assistant tool calls]: ${String(part.name)}`;
          return '';
        }).filter(Boolean).join('\n') ?? '';
    return `[${label}]: ${content}`;
  }).join('\n');
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

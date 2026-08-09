import type { AgentMessage } from '@earendil-works/pi-agent-core';
import type { UserMessage } from '@earendil-works/pi-ai';
import type {
  CompactionEntry,
  SessionEntry,
  SessionHeader,
} from '@earendil-works/pi-coding-agent';

import {
  PIVI_COMPACTION_BOUNDARY,
  PIVI_MESSAGE_UI,
  PIVI_SESSION_META,
  PIVI_UI_CONTEXT,
} from '../../../session/types';
import {
  missingAgentMessages,
  type MissingAgentMessagesOptions,
} from './agentMessageHistory';

export type PiSessionJsonlRevision = unknown;

export class PiSessionJsonlError extends Error {
  constructor(message: string, readonly line?: number) {
    super(line === undefined ? message : `Pi session JSONL line ${line}: ${message}`);
    this.name = 'PiSessionJsonlError';
  }
}

export class UnsupportedPiSessionVersionError extends PiSessionJsonlError {
  constructor(readonly version: number | undefined) {
    super(`unsupported session version ${version ?? 1}; only v3 is supported` , 1);
    this.name = 'UnsupportedPiSessionVersionError';
  }
}

export class StalePiSessionPlanError extends Error {
  constructor() {
    super('Pi session mutation plan is stale');
    this.name = 'StalePiSessionPlanError';
  }
}

export interface PiSessionJsonlFactories {
  now?: () => Date | string;
  entryId?: (existingIds: ReadonlySet<string>) => string;
  sessionId?: () => string;
}

function migrateRecords(records: Record<string, unknown>[], factories: PiSessionJsonlFactories): boolean {
  const header = records.find(record => record.type === 'session');
  const version = typeof header?.version === 'number' ? header.version : 1;
  if (version >= 3) return false;
  if (version < 2) {
    const ids = new Set<string>();
    let previous: string | null = null;
    for (const [index, record] of records.entries()) {
      if (record.type === 'session') { record.version = 2; continue; }
      let id = '';
      for (let attempts = 0; attempts < 100 && (!id || ids.has(id)); attempts++) {
        id = factories.entryId?.(ids) ?? browserUuid().slice(0, 8);
      }
      if (!id || ids.has(id)) throw new PiSessionJsonlError('unable to migrate entry id', index + 1);
      record.id = id; record.parentId = previous; ids.add(id); previous = id;
      if (record.type === 'compaction' && typeof record.firstKeptEntryIndex === 'number') {
        const target = records[record.firstKeptEntryIndex];
        if (target?.type !== 'session' && typeof target?.id === 'string') record.firstKeptEntryId = target.id;
        Reflect.deleteProperty(record, 'firstKeptEntryIndex');
      }
    }
  }
  for (const record of records) {
    if (record.type === 'session') record.version = 3;
    if (record.type === 'message' && isRecord(record.message) && record.message.role === 'hookMessage') {
      record.message.role = 'custom';
    }
  }
  return true;
}

export interface PiSessionAppendPlan {
  readonly kind: 'append';
  readonly baseGeneration: number;
  readonly baseLeafId: string | null;
  readonly entries: readonly SessionEntry[];
  readonly appendBytes: string;
  readonly resultingLeafId: string | null;
}

export interface PiSessionReplacementPlan {
  readonly kind: 'replace';
  readonly baseGeneration: number;
  readonly baseLeafId: string | null;
  readonly header: SessionHeader;
  readonly entries: readonly SessionEntry[];
  readonly documentBytes: string;
  readonly resultingLeafId: string | null;
}

export interface PiSessionForkPlan {
  readonly header: SessionHeader;
  readonly entries: readonly SessionEntry[];
  readonly documentBytes: string;
  readonly resultingLeafId: string | null;
}

function browserUuid(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function isoNow(factory?: () => Date | string): string {
  const value = factory?.() ?? new Date();
  return typeof value === 'string' ? value : value.toISOString();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function serialize(header: SessionHeader, entries: readonly SessionEntry[]): string {
  return [header, ...entries].map(value => `${JSON.stringify(value)}\n`).join('');
}

function assertHeader(value: unknown): asserts value is SessionHeader {
  if (!isRecord(value) || value.type !== 'session' || typeof value.id !== 'string'
    || !value.id || typeof value.timestamp !== 'string' || typeof value.cwd !== 'string'
    || (value.parentSession !== undefined && typeof value.parentSession !== 'string')) {
    throw new PiSessionJsonlError('missing or invalid v3 session header', 1);
  }
  if (value.version !== 3) {
    const version = typeof value.version === 'number' ? value.version : undefined;
    throw new UnsupportedPiSessionVersionError(version);
  }
}

function assertEntry(value: unknown, line: number): asserts value is SessionEntry {
  if (!isRecord(value) || value.type === 'session' || typeof value.type !== 'string'
    || typeof value.id !== 'string' || !value.id
    || (value.parentId !== null && typeof value.parentId !== 'string')
    || typeof value.timestamp !== 'string') {
    throw new PiSessionJsonlError('invalid session entry', line);
  }
}

/** Browser-safe, semantic Pi v3 JSONL document. Existing source bytes are never normalized. */
export class PiSessionJsonlDocument {
  readonly sourceContent: string;
  readonly sourceRevision: PiSessionJsonlRevision;
  readonly migrationRequired: boolean;
  private readonly factories: Required<PiSessionJsonlFactories>;
  private readonly byId = new Map<string, SessionEntry>();
  private generation = 0;

  private constructor(
    private readonly sessionHeader: SessionHeader,
    private orderedEntries: SessionEntry[],
    sourceContent: string,
    sourceRevision: PiSessionJsonlRevision,
    factories: PiSessionJsonlFactories,
    migrationRequired = false,
  ) {
    this.sourceContent = sourceContent;
    this.sourceRevision = sourceRevision;
    this.migrationRequired = migrationRequired;
    this.factories = {
      now: factories.now ?? (() => new Date()),
      sessionId: factories.sessionId ?? browserUuid,
      entryId: factories.entryId ?? (() => browserUuid().slice(0, 8)),
    };
    for (const entry of orderedEntries) this.byId.set(entry.id, entry);
  }

  static parse(
    content: string,
    options: PiSessionJsonlFactories & { revision?: PiSessionJsonlRevision } = {},
  ): PiSessionJsonlDocument {
    const records: unknown[] = [];
    const lines = content.split('\n');
    for (let index = 0; index < lines.length; index++) {
      const line = lines[index]!;
      if (!line.trim()) continue;
      try {
        records.push(JSON.parse(line) as unknown);
      } catch (error) {
        throw new PiSessionJsonlError(
          `malformed JSON (${error instanceof Error ? error.message : 'parse failure'})`, index + 1,
        );
      }
    }
    const migrationRequired = migrateRecords(records as Record<string, unknown>[], options);
    assertHeader(records[0]);
    const entries = records.slice(1);
    const byId = new Map<string, SessionEntry>();
    for (let index = 0; index < entries.length; index++) {
      const value = entries[index];
      assertEntry(value, index + 2);
      if (byId.has(value.id)) throw new PiSessionJsonlError(`duplicate entry id ${value.id}`, index + 2);
      byId.set(value.id, value);
    }
    for (let index = 0; index < entries.length; index++) {
      const entry = entries[index] as SessionEntry;
      if (entry.parentId !== null && !byId.has(entry.parentId)) {
        throw new PiSessionJsonlError(`missing parent ${entry.parentId}`, index + 2);
      }
      const visited = new Set<string>();
      let current: SessionEntry | undefined = entry;
      while (current) {
        if (visited.has(current.id)) throw new PiSessionJsonlError(`parent cycle at ${current.id}`, index + 2);
        visited.add(current.id);
        current = current.parentId ? byId.get(current.parentId) : undefined;
      }
    }
    const sourceContent = migrationRequired
      ? serialize(records[0], entries as SessionEntry[])
      : content;
    return new PiSessionJsonlDocument(records[0], entries as SessionEntry[], sourceContent,
      options.revision, options, migrationRequired);
  }

  static create(cwd: string, options: PiSessionJsonlFactories & {
    parentSession?: string;
    revision?: PiSessionJsonlRevision;
  } = {}): PiSessionJsonlDocument {
    const header: SessionHeader = {
      type: 'session', version: 3, id: options.sessionId?.() ?? browserUuid(),
      timestamp: isoNow(options.now), cwd, parentSession: options.parentSession,
    };
    const bytes = `${JSON.stringify(header)}\n`;
    return new PiSessionJsonlDocument(header, [], bytes, options.revision, options);
  }

  get header(): SessionHeader { return this.sessionHeader; }
  get sessionId(): string { return this.sessionHeader.id; }
  get entries(): readonly SessionEntry[] { return this.orderedEntries; }
  get leafId(): string | null { return this.orderedEntries.at(-1)?.id ?? null; }
  get leaf(): SessionEntry | undefined { return this.orderedEntries.at(-1); }
  getEntry(id: string): SessionEntry | undefined { return this.byId.get(id); }

  getBranch(leafId: string | null = this.leafId): SessionEntry[] {
    if (leafId === null) return [];
    let entry = this.byId.get(leafId);
    if (!entry) throw new PiSessionJsonlError(`entry ${leafId} not found`);
    const path: SessionEntry[] = [];
    while (entry) {
      path.push(entry);
      entry = entry.parentId ? this.byId.get(entry.parentId) : undefined;
    }
    return path.reverse();
  }

  private nextId(existing: Set<string>): string {
    for (let attempts = 0; attempts < 100; attempts++) {
      const id = this.factories.entryId(existing);
      if (id && !existing.has(id)) return id;
    }
    throw new Error('Unable to generate a unique Pi session entry id');
  }

  private appendPlan(builders: Array<(id: string, parentId: string | null) => SessionEntry>): PiSessionAppendPlan {
    const existing = new Set(this.byId.keys());
    const entries: SessionEntry[] = [];
    let parentId = this.leafId;
    for (const builder of builders) {
      const id = this.nextId(existing);
      existing.add(id);
      const entry = builder(id, parentId);
      entries.push(entry);
      parentId = id;
    }
    return {
      kind: 'append', baseGeneration: this.generation, baseLeafId: this.leafId,
      entries, appendBytes: entries.map(entry => `${JSON.stringify(entry)}\n`).join(''),
      resultingLeafId: parentId,
    };
  }

  planMessage(message: AgentMessage): PiSessionAppendPlan {
    return this.appendPlan([(id, parentId) => ({
      type: 'message', id, parentId, timestamp: isoNow(this.factories.now), message,
    })]);
  }

  planUserMessage(content: UserMessage['content'], timestamp: number): PiSessionAppendPlan {
    return this.planMessage({ role: 'user', content, timestamp });
  }

  planUserTurn(content: UserMessage['content'], timestamp: number, messageUi?: unknown): PiSessionAppendPlan {
    let userEntryId = '';
    return this.appendPlan([
      (id, parentId) => {
        userEntryId = id;
        return {
          type: 'message', id, parentId, timestamp: isoNow(this.factories.now),
          message: { role: 'user', content, timestamp },
        };
      },
      ...messageUi === undefined ? [] : [(id: string, parentId: string | null): SessionEntry => ({
        type: 'custom', customType: PIVI_MESSAGE_UI,
        data: { ...(messageUi as Record<string, unknown>), targetEntryId: userEntryId },
        id, parentId, timestamp: isoNow(this.factories.now),
      })],
    ]);
  }

  planCustom(customType: string, data?: unknown): PiSessionAppendPlan {
    return this.appendPlan([(id, parentId) => ({
      type: 'custom', customType, data, id, parentId, timestamp: isoNow(this.factories.now),
    })]);
  }

  planMessageUi(data: unknown): PiSessionAppendPlan { return this.planCustom(PIVI_MESSAGE_UI, data); }
  planSessionMeta(data: unknown): PiSessionAppendPlan { return this.planCustom(PIVI_SESSION_META, data); }
  planUiContext(data: unknown): PiSessionAppendPlan { return this.planCustom(PIVI_UI_CONTEXT, data); }

  planCompaction(
    summary: string, firstKeptEntryId: string, tokensBefore: number,
    details?: unknown, usage?: CompactionEntry['usage'], fromHook?: boolean,
  ): PiSessionAppendPlan {
    return this.appendPlan([(id, parentId) => ({
      type: 'compaction', id, parentId, timestamp: isoNow(this.factories.now),
      summary, firstKeptEntryId, tokensBefore, details, usage, fromHook,
    })]);
  }

  planFullReplacementCompaction(
    tokensBefore: number,
    createDetails: (boundaryId: string) => { summary: string; details: unknown },
  ): PiSessionAppendPlan {
    return this.appendPlan([
      (id, parentId) => ({
        type: 'custom', customType: PIVI_COMPACTION_BOUNDARY,
        data: { schemaVersion: 1 }, id, parentId,
        timestamp: isoNow(this.factories.now),
      }),
      (id, parentId) => {
        const { summary, details } = createDetails(parentId!);
        return {
          type: 'compaction', id, parentId, timestamp: isoNow(this.factories.now),
          summary, firstKeptEntryId: parentId!, tokensBefore, details,
        };
      },
    ]);
  }

  planAgentMessageSync(
    incoming: AgentMessage[], options: MissingAgentMessagesOptions = {},
    existingContext: AgentMessage[] = this.getBranch()
      .filter((entry): entry is SessionEntry & { type: 'message'; message: AgentMessage } => entry.type === 'message')
      .map(entry => entry.message),
  ): PiSessionAppendPlan {
    const missing = missingAgentMessages(existingContext, incoming, options);
    return this.appendPlan(missing.map(message => (id, parentId) => ({
      type: 'message', id, parentId, timestamp: isoNow(this.factories.now), message,
    })));
  }

  apply(plan: PiSessionAppendPlan | PiSessionReplacementPlan): void {
    if (plan.baseGeneration !== this.generation || plan.baseLeafId !== this.leafId) {
      throw new StalePiSessionPlanError();
    }
    if (plan.kind === 'replace') {
      if (plan.header.id !== this.sessionHeader.id
        || plan.documentBytes !== serialize(plan.header, plan.entries)
        || plan.resultingLeafId !== (plan.entries.at(-1)?.id ?? null)) {
        throw new StalePiSessionPlanError();
      }
      this.orderedEntries = [...plan.entries];
      this.byId.clear();
      for (const entry of this.orderedEntries) this.byId.set(entry.id, entry);
      this.generation++;
      return;
    }
    let expectedParent = this.leafId;
    for (const entry of plan.entries) {
      if (entry.parentId !== expectedParent || this.byId.has(entry.id)) throw new StalePiSessionPlanError();
      expectedParent = entry.id;
    }
    if (expectedParent !== plan.resultingLeafId
      || plan.appendBytes !== plan.entries.map(entry => `${JSON.stringify(entry)}\n`).join('')) {
      throw new StalePiSessionPlanError();
    }
    for (const entry of plan.entries) {
      this.orderedEntries.push(entry);
      this.byId.set(entry.id, entry);
    }
    this.generation++;
  }

  planTruncate(entryId: string | null): PiSessionReplacementPlan {
    const end = entryId === null ? 0 : this.orderedEntries.findIndex(entry => entry.id === entryId) + 1;
    if (entryId !== null && end === 0) throw new PiSessionJsonlError(`entry ${entryId} not found`);
    const entries = this.orderedEntries.slice(0, end);
    return { kind: 'replace', baseGeneration: this.generation, baseLeafId: this.leafId,
      header: this.sessionHeader, entries, documentBytes: serialize(this.sessionHeader, entries),
      resultingLeafId: entries.at(-1)?.id ?? null };
  }

  planFork(entryId: string, cwd: string, parentSession: string): PiSessionForkPlan {
    const path = this.getBranch(entryId);
    const copied: SessionEntry[] = [];
    let parentId: string | null = null;
    for (const entry of path) {
      if (entry.type === 'label') continue;
      copied.push({ ...entry, parentId });
      parentId = entry.id;
    }
    const header: SessionHeader = {
      type: 'session', version: 3, id: this.factories.sessionId(),
      timestamp: isoNow(this.factories.now), cwd, parentSession,
    };
    return { header, entries: copied, documentBytes: serialize(header, copied), resultingLeafId: parentId };
  }
}

import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import {
  acknowledgeJournalEntry,
  createJournalEntryId,
  emptySessionJournalState,
  hashAppendLines,
  normalizeSessionJournalState,
  removeJournalEntry,
  sealJournalEntryWithAppend,
  sessionDivergenceIdentity,
  SESSION_JOURNAL_MAX_ENTRY_BYTES,
  SessionJournalBoundsError,
  type SessionJournalEntryV1,
  type SessionJournalStateV1,
  type SessionJournalStore,
  type SessionJsonlSourceFingerprint,
  upsertJournalEntry,
} from '@pivi/pivi-agent-core/session/sessionJournal';
import {
  captureSessionJsonlSource,
  configureSessionJsonlIndexRoot,
  getLegacySessionJsonlIndexPath,
  getSessionJsonlIndexPath,
  invalidateSessionJsonlIndex,
  readSessionJsonlIndex,
  rebuildSessionJsonlIndex,
} from '@pivi/pivi-agent-core/engine/pi/session/sessionJsonlIndex';
import {
  classifyJournalDivergence,
  reconcileJournalEntry,
  reconcileSessionJournal,
} from '@pivi/pivi-agent-core/engine/pi/session/sessionRecovery';
import { getPiviSessionDir } from '@pivi/pivi-agent-core/session/sessionPaths';

function memoryJournalStore(initial?: SessionJournalStateV1): SessionJournalStore {
  let state = initial ?? emptySessionJournalState();
  return {
    load: () => normalizeSessionJournalState(structuredClone(state)),
    save: (next) => {
      state = normalizeSessionJournalState(next);
    },
  };
}

function makeSessionHeader(id: string): string {
  return JSON.stringify({
    type: 'session',
    version: 3,
    id,
    timestamp: 1,
    cwd: '/vault',
    parentSession: null,
  });
}

function makeMessageLine(id: string, text: string): string {
  return JSON.stringify({
    type: 'message',
    id,
    parentId: null,
    timestamp: 2,
    message: { role: 'user', content: text, timestamp: 2 },
  });
}

function writeSession(absolute: string, lines: string[]): void {
  mkdirSync(join(absolute, '..'), { recursive: true });
  writeFileSync(absolute, `${lines.join('\n')}\n`);
}

describe('session journal schema', () => {
  it('normalizes and drops invalid entries', () => {
    const state = normalizeSessionJournalState({
      version: 1,
      entries: [
        { version: 1, id: 'bad' },
        null,
      ],
      recoveredIdentities: { a: 'sessions/x.jsonl' },
    });
    expect(state.entries).toEqual([]);
    expect(state.recoveredIdentities).toEqual({ a: 'sessions/x.jsonl' });
  });

  it('rejects oversized journal entries', () => {
    const huge = 'x'.repeat(SESSION_JOURNAL_MAX_ENTRY_BYTES);
    const entry: SessionJournalEntryV1 = {
      version: 1,
      id: 'big',
      sessionFile: 's.jsonl',
      createdAt: 1,
      status: 'pending',
      baseFingerprint: {
        size: 1,
        device: '1',
        inode: '1',
        modifiedNs: '1',
        headSha256: 'a',
        tailSha256: 'b',
      },
      intent: { kind: 'jsonl-lines', lines: [huge] },
    };
    expect(() => upsertJournalEntry(emptySessionJournalState(), entry))
      .toThrow(SessionJournalBoundsError);
  });

  it('acknowledge retains the complete bounded continuation chain', () => {
    const fp: SessionJsonlSourceFingerprint = {
      size: 10,
      device: '1',
      inode: '1',
      modifiedNs: '1',
      headSha256: 'h',
      tailSha256: 't',
    };
    let state = emptySessionJournalState();
    const first: SessionJournalEntryV1 = {
      version: 1,
      id: 'one',
      sessionFile: 'a.jsonl',
      createdAt: 1,
      status: 'pending',
      baseFingerprint: fp,
      intent: { kind: 'jsonl-lines', lines: ['{}'] },
      resultFingerprint: fp,
    };
    const second: SessionJournalEntryV1 = {
      ...first,
      id: 'two',
      createdAt: 2,
    };
    state = upsertJournalEntry(state, first);
    state = acknowledgeJournalEntry(state, 'one');
    state = upsertJournalEntry(state, second);
    state = acknowledgeJournalEntry(state, 'two');
    expect(state.entries.map((entry) => entry.id)).toEqual(['one', 'two']);
    expect(state.entries[0]?.status).toBe('confirmed');
  });
});

describe('session cloud recovery fault matrix', () => {
  let vaultPath: string;
  let indexRoot: string;
  let sessionAbsolute: string;
  let sessionRelative: string;

  beforeEach(() => {
    vaultPath = join(tmpdir(), `pivi-recovery-${process.pid}-${Date.now()}`);
    indexRoot = join(vaultPath, '.device-indexes');
    mkdirSync(getPiviSessionDir(vaultPath), { recursive: true });
    configureSessionJsonlIndexRoot(indexRoot);
    sessionRelative = `${getPiviSessionDir(vaultPath).slice(vaultPath.length + 1)}/chat.jsonl`;
    sessionAbsolute = join(vaultPath, sessionRelative);
  });

  afterEach(() => {
    configureSessionJsonlIndexRoot(null);
    rmSync(vaultPath, { recursive: true, force: true });
  });

  function seedBaseAndAppend(): {
    base: SessionJsonlSourceFingerprint;
    result: SessionJsonlSourceFingerprint;
    lines: string[];
    entry: SessionJournalEntryV1;
  } {
    const header = makeSessionHeader('sess-1');
    const baseLine = makeMessageLine('u1', 'hello');
    writeSession(sessionAbsolute, [header, baseLine]);
    const base = captureSessionJsonlSource(sessionAbsolute);
    const appendLine = makeMessageLine('u2', 'local-turn');
    writeSession(sessionAbsolute, [header, baseLine, appendLine]);
    const result = captureSessionJsonlSource(sessionAbsolute);
    const lines = [appendLine];
    const intent = { kind: 'jsonl-lines' as const, lines };
    const id = createJournalEntryId(sessionRelative, base, intent, 42);
    const entry = sealJournalEntryWithAppend(
      {
        version: 1,
        id,
        sessionFile: sessionRelative,
        createdAt: 42,
        status: 'intent',
        baseFingerprint: base,
        intent,
      },
      ['u2'],
      lines,
      result,
    );
    return { base, result, lines, entry };
  }

  it('acks a completed turn after normal append', () => {
    const { entry, result } = seedBaseAndAppend();
    const store = memoryJournalStore(upsertJournalEntry(emptySessionJournalState(), {
      ...entry,
      status: 'pending',
    }));
    // Source still matches sealed result.
    writeFileSync(sessionAbsolute, readFileSync(sessionAbsolute));
    void result;
    const recovered = reconcileJournalEntry(vaultPath, store, store.load().entries[0]!);
    expect(recovered.action).toBe('ack');
    expect(store.load().entries).toHaveLength(1);
    expect(store.load().entries[0]?.status).toBe('confirmed');
  });

  it('applies journal after crash before JSONL append', () => {
    const { base, lines, entry } = seedBaseAndAppend();
    // Roll file back to base (simulate crash before append persisted).
    const content = readFileSync(sessionAbsolute);
    writeFileSync(sessionAbsolute, content.subarray(0, base.size));
    const pending = {
      ...entry,
      status: 'pending' as const,
      resultFingerprint: undefined,
    };
    const store = memoryJournalStore(upsertJournalEntry(emptySessionJournalState(), pending));
    const result = reconcileJournalEntry(vaultPath, store, store.load().entries[0]!);
    expect(result.action).toBe('apply_append');
    expect(readFileSync(sessionAbsolute, 'utf8')).toContain(lines[0]!);
    expect(store.load().entries).toHaveLength(1);
    expect(store.load().entries[0]?.status).toBe('confirmed');
  });

  it('completes an interrupted append', () => {
    const header = makeSessionHeader('sess-1');
    const baseLine = makeMessageLine('u1', 'hello');
    writeSession(sessionAbsolute, [header, baseLine]);
    const base = captureSessionJsonlSource(sessionAbsolute);
    const lineA = makeMessageLine('u2', 'part-a');
    const lineB = makeMessageLine('u3', 'part-b');
    const lines = [lineA, lineB];
    // Only the first sealed line reached disk.
    writeSession(sessionAbsolute, [header, baseLine, lineA]);
    const intent = { kind: 'jsonl-lines' as const, lines };
    const id = createJournalEntryId(sessionRelative, base, intent, 42);
    const entry: SessionJournalEntryV1 = {
      version: 1,
      id,
      sessionFile: sessionRelative,
      createdAt: 42,
      status: 'pending',
      baseFingerprint: base,
      intent,
      entryIds: ['u2', 'u3'],
      appendLines: lines,
      appendSha256: hashAppendLines(lines),
    };
    const store = memoryJournalStore(upsertJournalEntry(emptySessionJournalState(), entry));
    const result = reconcileJournalEntry(vaultPath, store, store.load().entries[0]!);
    expect(result.action).toBe('complete_interrupted');
    const text = readFileSync(sessionAbsolute, 'utf8');
    expect(text).toContain(lineA);
    expect(text).toContain(lineB);
  });

  it('repairs a malformed byte-partial JSON append before classifying corrupt tail', () => {
    const { base, lines, entry } = seedBaseAndAppend();
    const partial = Buffer.from(`${lines[0]}\n`).subarray(0, Math.floor(lines[0]!.length / 2));
    writeFileSync(sessionAbsolute, Buffer.concat([
      readFileSync(sessionAbsolute).subarray(0, base.size),
      partial,
    ]));
    const store = memoryJournalStore(upsertJournalEntry(emptySessionJournalState(), entry));
    const result = reconcileJournalEntry(vaultPath, store, entry);
    expect(result.classification.kind).toBe('interrupted_append');
    expect(result.action).toBe('complete_interrupted');
    expect(readFileSync(sessionAbsolute, 'utf8')).toContain(lines[0]!);
  });

  it('recovers an intent into a separate valid session after its append tears before sealing', () => {
    const header = makeSessionHeader('sess-1');
    const baseLine = makeMessageLine('base-message', 'hello');
    writeSession(sessionAbsolute, [header, baseLine]);
    const base = captureSessionJsonlSource(sessionAbsolute);
    const intent = { kind: 'user' as const, content: 'recover this turn' };
    const entry: SessionJournalEntryV1 = {
      version: 1,
      id: createJournalEntryId(sessionRelative, base, intent, 42),
      sessionFile: sessionRelative,
      createdAt: 42,
      status: 'intent',
      baseFingerprint: base,
      intent,
    };
    writeFileSync(sessionAbsolute, Buffer.concat([
      readFileSync(sessionAbsolute),
      Buffer.from('{"type":"message","id":"torn'),
    ]));
    const store = memoryJournalStore(upsertJournalEntry(emptySessionJournalState(), entry));

    const result = reconcileJournalEntry(vaultPath, store, entry);

    expect(result.classification.kind).toBe('corrupt_tail');
    expect(result.action).toBe('recovered_session');
    const recoveredLines = readFileSync(join(vaultPath, result.recoveredSessionFile!), 'utf8')
      .trimEnd()
      .split('\n')
      .map(line => JSON.parse(line) as Record<string, unknown>);
    const recoveredMessage = recoveredLines.find(line => (
      line.type === 'message' && JSON.stringify(line).includes('recover this turn')
    ));
    const provenance = recoveredLines.at(-1)!;
    expect(recoveredMessage).toMatchObject({ parentId: 'base-message' });
    expect(provenance).toMatchObject({
      type: 'custom',
      parentId: recoveredMessage?.id,
    });
    expect(typeof provenance.timestamp).toBe('string');
  });

  it('acks after append before acknowledgment', () => {
    const { entry } = seedBaseAndAppend();
    const store = memoryJournalStore(upsertJournalEntry(emptySessionJournalState(), {
      ...entry,
      status: 'pending',
    }));
    const result = reconcileJournalEntry(vaultPath, store, store.load().entries[0]!);
    expect(result.classification.kind).toBe('unacknowledged');
    expect(result.action).toBe('ack');
    expect(store.load().entries[0]?.status).toBe('confirmed');
  });

  it('seals an intent when the append landed before its acknowledgment', () => {
    const { base, lines } = seedBaseAndAppend();
    const intent = { kind: 'user' as const, content: 'local-turn' };
    const entry: SessionJournalEntryV1 = {
      version: 1,
      id: createJournalEntryId(sessionRelative, base, intent, 42),
      sessionFile: sessionRelative,
      createdAt: 42,
      status: 'intent',
      baseFingerprint: base,
      intent,
    };
    const store = memoryJournalStore(upsertJournalEntry(emptySessionJournalState(), entry));
    const result = reconcileJournalEntry(vaultPath, store, entry);
    expect(result.classification.kind).toBe('unacknowledged');
    expect(store.load().entries[0]).toMatchObject({
      status: 'confirmed',
      appendLines: lines,
    });
  });

  it('materializes intent with Pi timestamps, image shape, and base parent linkage', () => {
    const header = makeSessionHeader('sess-1');
    const baseLine = makeMessageLine('base-message', 'hello');
    writeSession(sessionAbsolute, [header, baseLine]);
    const base = captureSessionJsonlSource(sessionAbsolute);
    const intent = {
      kind: 'user' as const,
      content: 'with image',
      images: [{ data: 'abc', mediaType: 'image/png' }],
    };
    const entry: SessionJournalEntryV1 = {
      version: 1,
      id: createJournalEntryId(sessionRelative, base, intent, 42),
      sessionFile: sessionRelative,
      createdAt: 42,
      status: 'intent',
      baseFingerprint: base,
      intent,
    };
    const store = memoryJournalStore(upsertJournalEntry(emptySessionJournalState(), entry));
    expect(reconcileJournalEntry(vaultPath, store, entry).action).toBe('apply_append');
    const appended = JSON.parse(readFileSync(sessionAbsolute, 'utf8').trimEnd().split('\n').at(-1)!);
    expect(appended).toMatchObject({
      type: 'message',
      parentId: 'base-message',
      timestamp: new Date(42).toISOString(),
      message: {
        content: [
          { type: 'text', text: 'with image' },
          { type: 'image', data: 'abc', mimeType: 'image/png' },
        ],
      },
    });
  });

  it('retains matching evidence for a later cloud rollback', () => {
    const { base, entry } = seedBaseAndAppend();
    const store = memoryJournalStore(upsertJournalEntry(emptySessionJournalState(), {
      ...entry, status: 'confirmed',
    }));
    expect(reconcileSessionJournal(vaultPath, store)[0]?.action).toBe('ack');
    expect(store.load().entries).toHaveLength(1);
    writeFileSync(sessionAbsolute, readFileSync(sessionAbsolute).subarray(0, base.size));
    expect(reconcileSessionJournal(vaultPath, store)[0]?.action).toBe('recovered_session');
  });

  it('coalesces every retained fragment when a multi-fragment turn rolls back', () => {
    const first = seedBaseAndAppend();
    const secondBase = first.result;
    const secondLine = makeMessageLine('a2', 'assistant-fragment');
    writeFileSync(sessionAbsolute, `${readFileSync(sessionAbsolute, 'utf8')}${secondLine}\n`);
    const secondResult = captureSessionJsonlSource(sessionAbsolute);
    const intent = { kind: 'jsonl-lines' as const, lines: [secondLine] };
    const second = sealJournalEntryWithAppend({
      version: 1,
      id: createJournalEntryId(sessionRelative, secondBase, intent, 43),
      sessionFile: sessionRelative,
      createdAt: 43,
      status: 'intent',
      baseFingerprint: secondBase,
      intent,
    }, ['a2'], [secondLine], secondResult);
    let state = upsertJournalEntry(emptySessionJournalState(), { ...first.entry, status: 'confirmed' });
    state = upsertJournalEntry(state, { ...second, status: 'confirmed' });
    const store = memoryJournalStore(state);
    writeFileSync(sessionAbsolute, readFileSync(sessionAbsolute).subarray(0, first.base.size));
    const result = reconcileJournalEntry(vaultPath, store, store.load().entries[1]!);
    const recovered = readFileSync(join(vaultPath, result.recoveredSessionFile!), 'utf8');
    expect(recovered).toContain(first.lines[0]!);
    expect(recovered).toContain(secondLine);
  });

  it('excludes an unrelated pre-rewrite epoch from a recovered adjacent chain', () => {
    const first = seedBaseAndAppend();
    const unrelatedLine = makeMessageLine('old-epoch', 'must-not-recover');
    const unrelated = sealJournalEntryWithAppend({
      version: 1,
      id: 'old-epoch-row',
      sessionFile: sessionRelative,
      createdAt: 100,
      status: 'intent',
      baseFingerprint: { ...first.base, size: first.base.size + 1 },
      intent: { kind: 'jsonl-lines', lines: [unrelatedLine] },
    }, ['old-epoch'], [unrelatedLine], { ...first.base, size: first.base.size + 2 });
    let state = upsertJournalEntry(emptySessionJournalState(), { ...unrelated, status: 'confirmed' });
    state = upsertJournalEntry(state, { ...first.entry, status: 'confirmed', createdAt: 1 });
    const store = memoryJournalStore(state);
    writeFileSync(sessionAbsolute, readFileSync(sessionAbsolute).subarray(0, first.base.size));
    const result = reconcileJournalEntry(vaultPath, store, store.load().entries[1]!);
    const recovered = readFileSync(join(vaultPath, result.recoveredSessionFile!), 'utf8');
    expect(recovered).toContain(first.lines[0]!);
    expect(recovered).not.toContain('must-not-recover');
  });

  it('recovers rollback without overwriting the external source', () => {
    const { base, lines, entry } = seedBaseAndAppend();
    const before = readFileSync(sessionAbsolute);
    writeFileSync(sessionAbsolute, before.subarray(0, base.size));
    const rolled = readFileSync(sessionAbsolute);
    const store = memoryJournalStore(upsertJournalEntry(emptySessionJournalState(), {
      ...entry,
      status: 'confirmed',
    }));
    const result = reconcileJournalEntry(vaultPath, store, store.load().entries[0]!);
    expect(result.action).toBe('recovered_session');
    expect(result.recoveredSessionFile).toBeTruthy();
    expect(readFileSync(sessionAbsolute).equals(rolled)).toBe(true);
    const recoveredAbsolute = join(vaultPath, result.recoveredSessionFile!);
    const recoveredText = readFileSync(recoveredAbsolute, 'utf8');
    const recoveredHeader = JSON.parse(recoveredText.split('\n')[0]!) as Record<string, unknown>;
    expect(recoveredHeader.id).toBe(`recovered-${entry.id.slice(0, 12)}`);
    expect(recoveredHeader.id).not.toBe('sess-1');
    expect(recoveredText).toContain(lines[0]!);
    expect(recoveredText).toContain('recoverySourceSessionFile');
  });

  it('recovers truncation and replacement into explicit sessions', () => {
    const { entry } = seedBaseAndAppend();
    writeFileSync(sessionAbsolute, `${makeSessionHeader('other')}\n`);
    const store = memoryJournalStore(upsertJournalEntry(emptySessionJournalState(), {
      ...entry,
      status: 'confirmed',
    }));
    const first = reconcileJournalEntry(vaultPath, store, store.load().entries[0]!);
    expect(first.action).toBe('recovered_session');

    // Idempotent: same divergence identity does not create a second recovered session.
    const againState = upsertJournalEntry(emptySessionJournalState(), {
      ...entry,
      status: 'confirmed',
    });
    const store2 = memoryJournalStore({
      ...againState,
      recoveredIdentities: store.load().recoveredIdentities,
    });
    const second = reconcileJournalEntry(vaultPath, store2, store2.load().entries[0]!);
    expect(second.recoveredSessionFile).toBe(first.recoveredSessionFile);
  });

  it('detects concurrent append after the same fingerprint', () => {
    const { base, entry } = seedBaseAndAppend();
    const header = makeSessionHeader('sess-1');
    const baseLine = makeMessageLine('u1', 'hello');
    const foreign = makeMessageLine('ext', 'from-other-device');
    writeSession(sessionAbsolute, [header, baseLine, foreign]);
    void base;
    const kind = classifyJournalDivergence(vaultPath, {
      ...entry,
      status: 'confirmed',
      resultFingerprint: undefined,
    }).kind;
    expect(kind).toBe('concurrent_append');
  });

  it('handles missing and corrupt journal/index state', () => {
    const { entry } = seedBaseAndAppend();
    rmSync(sessionAbsolute, { force: true });
    const store = memoryJournalStore(upsertJournalEntry(emptySessionJournalState(), {
      ...entry,
      status: 'pending',
    }));
    const missing = reconcileJournalEntry(vaultPath, store, store.load().entries[0]!);
    expect(missing.classification.kind).toBe('missing_source');
    expect(missing.action).toBe('recovered_session');

    // Corrupt index beside a valid session is rebuilt.
    writeSession(sessionAbsolute, [makeSessionHeader('sess-2'), makeMessageLine('u1', 'x')]);
    const indexPath = getSessionJsonlIndexPath(sessionAbsolute);
    mkdirSync(indexRoot, { recursive: true });
    writeFileSync(indexPath, '{not-json\n');
    const index = readSessionJsonlIndex(sessionAbsolute);
    expect(index.entries.length).toBeGreaterThan(0);
  });

  it('moves rebuildable indexes to device-local storage', () => {
    writeSession(sessionAbsolute, [makeSessionHeader('sess-3'), makeMessageLine('u1', 'idx')]);
    const legacy = getLegacySessionJsonlIndexPath(sessionAbsolute);
    writeFileSync(legacy, 'stale');
    const index = rebuildSessionJsonlIndex(sessionAbsolute);
    expect(index.indexFile.startsWith(indexRoot)).toBe(true);
    expect(existsSync(legacy)).toBe(false);
    expect(existsSync(getSessionJsonlIndexPath(sessionAbsolute))).toBe(true);
    invalidateSessionJsonlIndex(sessionAbsolute);
    expect(existsSync(getSessionJsonlIndexPath(sessionAbsolute))).toBe(false);
  });

  it('keeps journal free of credentials and absolute external paths in fixtures', () => {
    const { entry } = seedBaseAndAppend();
    const serialized = JSON.stringify(entry);
    expect(serialized).not.toMatch(/sk-[a-zA-Z0-9]{10,}/);
    expect(serialized).not.toMatch(/\/Users\//);
    expect(serialized).not.toMatch(/\/home\//);
    expect(hashAppendLines(entry.appendLines ?? [])).toHaveLength(64);
    expect(sessionDivergenceIdentity(
      entry.sessionFile,
      entry.baseFingerprint,
      entry.appendSha256!,
    )).toHaveLength(64);
  });

  it('reconciles repeated startup without duplicate recovered sessions', () => {
    const { base, entry } = seedBaseAndAppend();
    writeFileSync(sessionAbsolute, readFileSync(sessionAbsolute).subarray(0, base.size));
    const store = memoryJournalStore(upsertJournalEntry(emptySessionJournalState(), {
      ...entry,
      status: 'confirmed',
    }));
    const first = reconcileSessionJournal(vaultPath, store);
    const second = reconcileSessionJournal(vaultPath, store);
    expect(first).toHaveLength(1);
    expect(first[0]?.action).toBe('recovered_session');
    expect(second).toHaveLength(0);
    expect(Object.keys(store.load().recoveredIdentities)).toHaveLength(1);
  });

  it('removeJournalEntry is idempotent during compaction crashes', () => {
    const { entry } = seedBaseAndAppend();
    let state = upsertJournalEntry(emptySessionJournalState(), entry);
    state = removeJournalEntry(state, entry.id);
    state = removeJournalEntry(state, entry.id);
    expect(state.entries).toHaveLength(0);
  });
});

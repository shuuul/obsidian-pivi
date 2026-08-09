import type { DeviceLocalExternalContextStore } from '@pivi/pivi-agent-core/session';
import { PIVI_MESSAGE_UI, PIVI_UI_CONTEXT } from '@pivi/pivi-agent-core/session/types';
import type { SessionContentRevision, SessionJsonlSnapshot, SessionJsonlStorage } from '@pivi/pivi-agent-core/engine/pi/session/sessionJsonlStorage';
import {
  SessionRevisionError,
  SessionWriteUncertainError,
} from '@pivi/pivi-agent-core/engine/pi/session/sessionJsonlStorage';
import { VaultPiSessionStore } from '@pivi/pivi-agent-core/engine/pi/session/vaultPiSessionStore';
import { VaultPiSessionTreeFactory } from '@pivi/pivi-agent-core/engine/pi/session/vaultPiSessionTree';

const NOW = '2026-08-09T12:34:56.789Z';

class MemoryStorage implements SessionJsonlStorage {
  readonly files = new Map<string, string>();
  readonly mtimes = new Map<string, number>();
  appendHooks: Array<(path: string, content: string) => void | Promise<void>> = [];
  replaceHooks: Array<(path: string, content: string) => void | Promise<void>> = [];
  replaceError?: Error;
  /** Definite append failure before any bytes land. */
  appendError?: Error;
  /** When set, append applies the bytes then throws uncertain (write landed). */
  appendUncertainAfterApply = false;
  async list() { return [...this.files.keys()].sort().map(path => ({ path, stat: { mtime: this.mtimes.get(path) ?? 0, ctime: 0, size: this.files.get(path)!.length } })); }
  async read(path: string) {
    const content = this.files.get(path);
    if (content === undefined) throw new Error(`missing ${path}`);
    return this.snapshot(path, content);
  }
  async create(path: string, content: string) { if (this.files.has(path)) throw new Error('collision'); this.files.set(path, content); return this.read(path); }
  async append(path: string, content: string, expected: SessionContentRevision) {
    if (this.appendError) throw this.appendError;
    const before = await this.read(path); this.check(path, before.revision, expected);
    for (const hook of this.appendHooks) await hook(path, content);
    this.files.set(path, before.content + content);
    if (this.appendUncertainAfterApply) throw new SessionWriteUncertainError(path);
    return this.read(path);
  }
  async replace(path: string, content: string, expected: SessionContentRevision) {
    const before = await this.read(path); this.check(path, before.revision, expected);
    for (const hook of this.replaceHooks) await hook(path, content);
    if (this.replaceError) throw this.replaceError;
    this.files.set(path, content); return this.read(path);
  }
  async delete(path: string, expected?: SessionContentRevision) { if (expected) this.check(path, (await this.read(path)).revision, expected); this.files.delete(path); }
  private check(path: string, actual: SessionContentRevision, expected: SessionContentRevision) { if (actual.sha256 !== expected.sha256 || actual.bytes !== expected.bytes) throw new SessionRevisionError(path); }
  private snapshot(path: string, content: string): SessionJsonlSnapshot { return { path, content, revision: { bytes: new TextEncoder().encode(content).byteLength, sha256: content } }; }
}

class Overlay implements DeviceLocalExternalContextStore {
  sessions = new Map<string, string[]>(); turns = new Map<string, string[]>();
  getSessionPaths(file: string) { return [...(this.sessions.get(file) ?? [])]; }
  setSessionPaths(file: string, paths: readonly string[]) { this.sessions.set(file, [...paths]); }
  getTurnPaths(file: string, id: string) { return [...(this.turns.get(`${file}:${id}`) ?? [])]; }
  setTurnPaths(file: string, id: string, paths: readonly string[]) { this.turns.set(`${file}:${id}`, [...paths]); }
  copySession(source: string, target: string) { this.setSessionPaths(target, this.getSessionPaths(source)); for (const [key, paths] of this.turns) if (key.startsWith(`${source}:`)) this.turns.set(`${target}:${key.slice(source.length + 1)}`, [...paths]); }
  deleteSession(file: string) { this.sessions.delete(file); for (const key of this.turns.keys()) if (key.startsWith(`${file}:`)) this.turns.delete(key); }
}

function harness(storage = new MemoryStorage(), overlay = new Overlay()) {
  let session = 0; let entry = 0;
  const trees = new VaultPiSessionTreeFactory(storage, {
    now: () => NOW, sessionId: () => `session-${++session}`,
    entryId: existing => { let id = ''; do id = `e${++entry}`; while (existing.has(id)); return id; },
  });
  return { storage, overlay, store: new VaultPiSessionStore(storage, trees, { externalContexts: overlay, now: () => 10 }) };
}

const line = (value: unknown) => `${JSON.stringify(value)}\n`;
const header = (id = 'fixture', version = 3) => ({ type: 'session', version, id, timestamp: NOW, cwd: '' });
const message = (id: string, parentId: string | null, role: string, content: unknown) => ({ type: 'message', id, parentId, timestamp: NOW, message: { role, content, timestamp: 1 } });

describe('VaultPiSessionStore', () => {
  it('creates, lists, opens, appends user and agent turns, and projects UI/meta', async () => {
    const { storage, store } = harness();
    const ref = await store.create('/ignored');
    expect(store.sessionRefFromOpenSession({ id: 'open' })).toBeNull();
    expect(store.sessionRefFromOpenSession({ id: 'open', sessionFile: ref.sessionFile })).toMatchObject({ sessionFile: ref.sessionFile, sessionId: 'open' });
    await store.appendUserTurn(ref, 'api prompt', { displayContent: '/visible', turnRequest: { text: 'api prompt', externalContextPaths: ['/device/secret'] } });
    const user = (await store.getMessages(ref))[0]!;
    await store.appendAgentTurn(ref, [
      { role: 'user', content: 'api prompt', timestamp: 1 },
      { role: 'assistant', content: 'answer', timestamp: 2 },
    ], [{ targetEntryId: 'e3', durationSeconds: 2 }]);
    await store.writeSessionMeta(ref, { title: 'Named', titleSource: 'model', lastResponseAt: 99 });
    await store.writeUiContext(ref, { currentNote: 'Daily.md', enabledMcpServers: ['mcp'], externalContextPaths: ['/session'] });
    expect(await store.open(ref.sessionFile)).toEqual(ref);
    expect(await store.listSessions('ignored')).toEqual([expect.objectContaining({ title: 'Named', titleSource: 'model', updatedAt: 99, messagePreview: 'api prompt', messageCount: 2 })]);
    expect(await store.getMessages(ref)).toEqual([
      expect.objectContaining({ id: user.id, displayContent: '/visible', turnRequest: expect.objectContaining({ externalContextPaths: ['/device/secret'] }) }),
      expect.objectContaining({ content: 'answer', durationSeconds: 2 }),
    ]);
    expect(await store.readUiContext(ref)).toEqual({ currentNote: 'Daily.md', enabledMcpServers: ['mcp'], externalContextPaths: ['/session'] });
    expect(storage.files.get(ref.sessionFile)).not.toContain('/device/secret');
  });

  it('implements paired pagination, cursors, and positive limits', async () => {
    const { storage, store } = harness(); const path = '.pivi/sessions/nested/page.jsonl';
    storage.files.set(path, [header(), message('u1', null, 'user', 'one'), message('a1', 'u1', 'assistant', 'two'), message('u2', 'a1', 'user', 'three')].map(line).join(''));
    const ref = await store.open(path);
    await expect(store.openRecent(ref, 2)).resolves.toMatchObject({ messages: [{ id: 'u1' }, { id: 'a1' }, { id: 'u2' }], hasOlder: false, totalMessageCount: 3 });
    await expect(store.readOlder(ref, 'a1', 1)).resolves.toMatchObject({ messages: [{ id: 'u1' }], olderMessageCount: 0 });
    await expect(store.readOlder(ref, 'missing', 2)).rejects.toMatchObject({ name: 'SessionRangeCursorError' });
    await expect(store.openRecent(ref, 0)).rejects.toBeInstanceOf(RangeError);
    await expect(store.readOlder(ref, 'a1', Number.NaN)).rejects.toBeInstanceOf(RangeError);
  });

  it('discovers root and nested sessions, skips malformed list entries, but explicit open reports the file', async () => {
    const { storage, store } = harness();
    storage.files.set('.pivi/sessions/root.jsonl', line(header('root')));
    storage.files.set('.pivi/sessions/device/nested.jsonl', line(header('nested')));
    storage.files.set('.pivi/sessions/bad.jsonl', '{bad\n');
    const warnings: unknown[] = [];
    const guarded = new VaultPiSessionStore(storage, new VaultPiSessionTreeFactory(storage), { logger: { warn: (...args) => warnings.push(args) } });
    expect((await guarded.listSessions('')).map(item => item.sessionId).sort()).toEqual(['nested', 'root']);
    expect(warnings).toHaveLength(1);
    await expect(store.open('.pivi/sessions/bad.jsonl')).rejects.toThrow(/Failed to open session \.pivi\/sessions\/bad\.jsonl.*line 1/);
  });

  it('migrates external contexts before open, persists exact stripped v3, and keeps overlays device-local', async () => {
    const { storage, overlay, store } = harness(); const path = '.pivi/sessions/external.jsonl';
    storage.files.set(path, [header(), message('u1', null, 'user', 'hello'), { type: 'custom', id: 'ctx', parentId: 'u1', timestamp: NOW, customType: PIVI_UI_CONTEXT, data: { currentNote: 'A.md', externalContextPaths: ['/session'] } }, { type: 'custom', id: 'ui', parentId: 'ctx', timestamp: NOW, customType: PIVI_MESSAGE_UI, data: { targetEntryId: 'u1', turnRequest: { text: 'hello', externalContextPaths: ['/turn'] } } }].map(line).join(''));
    await store.open(path);
    expect(storage.files.get(path)).toBe([header(), message('u1', null, 'user', 'hello'), { type: 'custom', id: 'ctx', parentId: 'u1', timestamp: NOW, customType: PIVI_UI_CONTEXT, data: { currentNote: 'A.md' } }, { type: 'custom', id: 'ui', parentId: 'ctx', timestamp: NOW, customType: PIVI_MESSAGE_UI, data: { targetEntryId: 'u1', turnRequest: { text: 'hello' } } }].map(line).join(''));
    expect(overlay.getSessionPaths(path)).toEqual(['/session']);
    expect((await store.getMessages({ sessionFile: path, sessionId: 'fixture' }))[0]?.turnRequest?.externalContextPaths).toEqual(['/turn']);
  });

  it('keeps two overlay stores independent over one shared Vault', async () => {
    const storage = new MemoryStorage(); const first = harness(storage, new Overlay()); const second = harness(storage, new Overlay());
    const ref = await first.store.create('');
    await first.store.writeUiContext(ref, { externalContextPaths: ['/first'] });
    await second.store.writeUiContext(ref, { externalContextPaths: ['/second'] });
    expect((await first.store.readUiContext(ref)).externalContextPaths).toEqual(['/first']);
    expect((await second.store.readUiContext(ref)).externalContextPaths).toEqual(['/second']);
    expect(storage.files.get(ref.sessionFile)).not.toMatch(/\/first|\/second/);
  });

  it('forks overlays, rejects unknown fork points, tombstones atomically, and detects stale source', async () => {
    const { storage, overlay, store } = harness(); const ref = await store.create('');
    await store.appendUserTurn(ref, 'first', { turnRequest: { text: 'first', externalContextPaths: ['/turn'] } });
    const userId = (await store.getMessages(ref))[0]!.id;
    overlay.setSessionPaths(ref.sessionFile, ['/session']);
    const fork = await store.fork(ref, userId);
    expect(overlay.getSessionPaths(fork.sessionFile)).toEqual(['/session']);
    expect(overlay.getTurnPaths(fork.sessionFile, userId)).toEqual(['/turn']);
    await expect(store.fork(ref, 'missing')).rejects.toThrow('Failed to fork session');
    const tree = await new VaultPiSessionTreeFactory(storage).open(ref.sessionFile);
    storage.files.set(ref.sessionFile, `${storage.files.get(ref.sessionFile)}${line({ external: true })}`);
    await expect(tree.appendUserMessage('stale')).rejects.toBeInstanceOf(SessionRevisionError);
    await store.deleteSession(fork.sessionFile);
    expect(storage.files.get(fork.sessionFile)).toContain('pivi/session-deleted');
    await expect(store.open(fork.sessionFile)).rejects.toThrow('Session is deleted');
    expect(await store.listSessions('')).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ sessionFile: fork.sessionFile }),
    ]));
    expect(overlay.getSessionPaths(fork.sessionFile)).toEqual([]);
  });

  it.each([1, 2])('migrates v%i bytes to exact v3 before returning from open', async version => {
    const { storage, store } = harness(); const path = `.pivi/sessions/v${version}.jsonl`;
    const source = version === 1
      ? [header('legacy', 1), { type: 'message', timestamp: NOW, message: { role: 'user', content: 'old', timestamp: 1 } }]
      : [header('legacy', 2), message('old-id', null, 'user', 'old')];
    storage.files.set(path, source.map(line).join(''));
    await store.open(path);
    const records = storage.files.get(path)!.trim().split('\n').map(value => JSON.parse(value));
    expect(records[0]).toEqual(header('legacy', 3));
    expect(records[1]).toMatchObject({ type: 'message', id: version === 1 ? 'e1' : 'old-id', parentId: null });
    expect(storage.files.get(path)).toBe(records.map(line).join(''));
  });

  it('single-flights concurrent migration and open for one legacy file', async () => {
    const { storage, store } = harness();
    const path = '.pivi/sessions/concurrent-legacy.jsonl';
    storage.files.set(path, line(header('legacy', 2)));

    const [first, second] = await Promise.all([store.open(path), store.open(path)]);

    expect(first).toEqual(second);
    expect(JSON.parse(storage.files.get(path)!.split('\n')[0]!).version).toBe(3);
  });

  it('serializes per-session JSONL and overlay effects through one operation queue', async () => {
    const { store, overlay } = harness();
    const ref = await store.create('');
    const order: string[] = [];

    await Promise.all([
      store.appendUserTurn(ref, 'first', {
        turnRequest: { text: 'first', externalContextPaths: ['/a'] },
      }).then(() => order.push('first')),
      store.appendUserTurn(ref, 'second', {
        turnRequest: { text: 'second', externalContextPaths: ['/b'] },
      }).then(() => order.push('second')),
      store.writeUiContext(ref, { externalContextPaths: ['/session'] }).then(() => order.push('ui')),
    ]);

    expect(order).toEqual(['first', 'second', 'ui']);
    const messages = await store.getMessages(ref);
    expect(messages.map(message => message.content)).toEqual(['first', 'second']);
    expect(overlay.getTurnPaths(ref.sessionFile, messages[0]!.id)).toEqual(['/a']);
    expect(overlay.getTurnPaths(ref.sessionFile, messages[1]!.id)).toEqual(['/b']);
    expect(overlay.getSessionPaths(ref.sessionFile)).toEqual(['/session']);
  });

  it('copies only represented fork overlays and leaves truncated-branch turns behind', async () => {
    const { store, overlay } = harness();
    const ref = await store.create('');
    await store.appendUserTurn(ref, 'keep', {
      turnRequest: { text: 'keep', externalContextPaths: ['/keep'] },
    });
    await store.appendUserTurn(ref, 'drop', {
      turnRequest: { text: 'drop', externalContextPaths: ['/drop'] },
    });
    const messages = await store.getMessages(ref);
    const keepId = messages[0]!.id;
    const dropId = messages[1]!.id;
    overlay.setSessionPaths(ref.sessionFile, ['/session']);

    const fork = await store.fork(ref, keepId);

    expect(overlay.getSessionPaths(fork.sessionFile)).toEqual(['/session']);
    expect(overlay.getTurnPaths(fork.sessionFile, keepId)).toEqual(['/keep']);
    expect(overlay.getTurnPaths(fork.sessionFile, dropId)).toEqual([]);
    expect(overlay.getTurnPaths(ref.sessionFile, dropId)).toEqual(['/drop']);
  });

  it('reconciles uncertain tombstone by reread and idempotent cleanup', async () => {
    const { storage, overlay, store } = harness();
    const ref = await store.create('');
    await store.appendUserTurn(ref, 'gone', {
      turnRequest: { text: 'gone', externalContextPaths: ['/turn'] },
    });
    overlay.setSessionPaths(ref.sessionFile, ['/session']);
    storage.appendUncertainAfterApply = true;

    await store.deleteSession(ref.sessionFile);

    expect(storage.files.get(ref.sessionFile)).toContain('pivi/session-deleted');
    expect(overlay.getSessionPaths(ref.sessionFile)).toEqual([]);
    expect(overlay.getTurnPaths(ref.sessionFile, 'e1')).toEqual([]);
    await expect(store.open(ref.sessionFile)).rejects.toThrow('Session is deleted');
    // Idempotent second delete after tombstone already landed.
    storage.appendUncertainAfterApply = false;
    await expect(store.deleteSession(ref.sessionFile)).resolves.toBeUndefined();
  });

  it('prevents concurrent overlay writes from resurrecting a tombstoned session', async () => {
    const { overlay, store } = harness();
    const ref = await store.create('');
    await store.writeUiContext(ref, { externalContextPaths: ['/before'] });

    const deleting = store.deleteSession(ref.sessionFile);
    const resurrect = store.writeUiContext(ref, { externalContextPaths: ['/resurrect'] })
      .then(() => 'wrote' as const)
      .catch(() => 'rejected' as const);

    const [deleteResult, writeResult] = await Promise.all([
      deleting.then(() => 'deleted' as const),
      resurrect,
    ]);

    expect(deleteResult).toBe('deleted');
    expect(['wrote', 'rejected']).toContain(writeResult);
    expect(overlay.getSessionPaths(ref.sessionFile)).toEqual([]);
    await expect(store.open(ref.sessionFile)).rejects.toThrow('Session is deleted');
  });

  it('publishes overlays before JSONL rewrite and shares one migration Promise for batch/open', async () => {
    const { storage, overlay, store } = harness();
    const path = '.pivi/sessions/overlay-first.jsonl';
    storage.files.set(path, [
      header(),
      message('u1', null, 'user', 'hello'),
      {
        type: 'custom', id: 'ctx', parentId: 'u1', timestamp: NOW, customType: PIVI_UI_CONTEXT,
        data: { currentNote: 'A.md', externalContextPaths: ['/session'] },
      },
      {
        type: 'custom', id: 'ui', parentId: 'ctx', timestamp: NOW, customType: PIVI_MESSAGE_UI,
        data: { targetEntryId: 'u1', turnRequest: { text: 'hello', externalContextPaths: ['/turn'] } },
      },
    ].map(line).join(''));

    const order: string[] = [];
    storage.replaceHooks.push(async () => {
      order.push('replace');
      expect(overlay.getSessionPaths(path)).toEqual(['/session']);
      expect(overlay.getTurnPaths(path, 'u1')).toEqual(['/turn']);
    });

    const batch = store.migrateDeviceLocalExternalContexts();
    const opened = store.open(path);
    const [count, ref] = await Promise.all([batch, opened]);

    expect(count).toBe(1);
    expect(ref.sessionFile).toBe(path);
    expect(order).toEqual(['replace']);
    expect(storage.files.get(path)).not.toContain('/session');
    expect(storage.files.get(path)).not.toContain('/turn');
  });

  it('reconciles uncertain external-context replace without double-writing overlays', async () => {
    const { storage, overlay, store } = harness();
    const path = '.pivi/sessions/uncertain-migrate.jsonl';
    const source = [
      header(),
      message('u1', null, 'user', 'hello'),
      {
        type: 'custom', id: 'ctx', parentId: 'u1', timestamp: NOW, customType: PIVI_UI_CONTEXT,
        data: { externalContextPaths: ['/session'] },
      },
    ].map(line).join('');
    storage.files.set(path, source);

    let attempts = 0;
    storage.replaceHooks.push(async (_path, content) => {
      attempts += 1;
      if (attempts === 1) {
        // Simulate write landed but verification failed.
        storage.files.set(path, content);
        throw new SessionWriteUncertainError(path);
      }
    });

    expect(await store.migrateDeviceLocalExternalContexts()).toBe(1);
    expect(attempts).toBe(1);
    expect(overlay.getSessionPaths(path)).toEqual(['/session']);
    expect(storage.files.get(path)).not.toContain('/session');
    // Second migration is a no-op (already stripped).
    expect(await store.migrateDeviceLocalExternalContexts()).toBe(0);
  });

  it('restores prior turn overlay on definite appendMessageUiPatches failure', async () => {
    const { storage, overlay, store } = harness();
    const ref = await store.create('');
    await store.appendUserTurn(ref, 'prompt', {
      turnRequest: { text: 'prompt', externalContextPaths: ['/prior-turn'] },
    });
    const userId = (await store.getMessages(ref))[0]!.id;
    expect(overlay.getTurnPaths(ref.sessionFile, userId)).toEqual(['/prior-turn']);

    storage.appendError = new SessionRevisionError(ref.sessionFile);
    await expect(store.appendMessageUiPatches(ref, [{
      targetEntryId: userId,
      durationSeconds: 3,
      turnRequest: { text: 'prompt', externalContextPaths: ['/new-turn'] },
    }])).rejects.toBeInstanceOf(Error);

    expect(overlay.getTurnPaths(ref.sessionFile, userId)).toEqual(['/prior-turn']);
  });

  it('retains new turn overlay on uncertain appendMessageUiPatches failure', async () => {
    const { storage, overlay, store } = harness();
    const ref = await store.create('');
    await store.appendUserTurn(ref, 'prompt', {
      turnRequest: { text: 'prompt', externalContextPaths: ['/prior-turn'] },
    });
    const userId = (await store.getMessages(ref))[0]!.id;
    storage.appendUncertainAfterApply = true;

    await expect(store.appendMessageUiPatches(ref, [{
      targetEntryId: userId,
      durationSeconds: 3,
      turnRequest: { text: 'prompt', externalContextPaths: ['/new-turn'] },
    }])).rejects.toBeInstanceOf(Error);

    expect(overlay.getTurnPaths(ref.sessionFile, userId)).toEqual(['/new-turn']);
  });

  it('restores prior session overlay on definite writeUiContext failure', async () => {
    const { storage, overlay, store } = harness();
    const ref = await store.create('');
    await store.writeUiContext(ref, { externalContextPaths: ['/prior-session'] });
    expect(overlay.getSessionPaths(ref.sessionFile)).toEqual(['/prior-session']);

    storage.appendError = new SessionRevisionError(ref.sessionFile);
    await expect(store.writeUiContext(ref, {
      currentNote: 'Note.md',
      externalContextPaths: ['/new-session'],
    })).rejects.toBeInstanceOf(Error);

    expect(overlay.getSessionPaths(ref.sessionFile)).toEqual(['/prior-session']);
  });

  it('retains new session overlay on uncertain writeUiContext failure', async () => {
    const { storage, overlay, store } = harness();
    const ref = await store.create('');
    await store.writeUiContext(ref, { externalContextPaths: ['/prior-session'] });
    storage.appendUncertainAfterApply = true;

    await expect(store.writeUiContext(ref, {
      currentNote: 'Note.md',
      externalContextPaths: ['/new-session'],
    })).rejects.toBeInstanceOf(Error);

    expect(overlay.getSessionPaths(ref.sessionFile)).toEqual(['/new-session']);
  });

  it('rolls back staged migration overlay when a different-header session replaces the path', async () => {
    const { storage, overlay, store } = harness();
    const path = '.pivi/sessions/header-swap.jsonl';
    const original = [
      header('original-session'),
      message('u1', null, 'user', 'hello'),
      {
        type: 'custom', id: 'ctx', parentId: 'u1', timestamp: NOW, customType: PIVI_UI_CONTEXT,
        data: { currentNote: 'A.md', externalContextPaths: ['/old-session'] },
      },
      {
        type: 'custom', id: 'ui', parentId: 'ctx', timestamp: NOW, customType: PIVI_MESSAGE_UI,
        data: { targetEntryId: 'u1', turnRequest: { text: 'hello', externalContextPaths: ['/old-turn'] } },
      },
    ].map(line).join('');
    const replacement = [
      header('replacement-session'),
      message('r1', null, 'user', 'other'),
    ].map(line).join('');
    storage.files.set(path, original);
    // Pre-existing empty overlay must be restored (not left as staged old-session paths).
    expect(overlay.getSessionPaths(path)).toEqual([]);

    storage.replaceHooks.push(async () => {
      // Concurrent cloud swap: different session header at the same path.
      storage.files.set(path, replacement);
      throw new SessionRevisionError(path);
    });

    await expect(store.migrateDeviceLocalExternalContexts()).rejects.toBeInstanceOf(SessionRevisionError);
    expect(overlay.getSessionPaths(path)).toEqual([]);
    expect(overlay.getTurnPaths(path, 'u1')).toEqual([]);
    // Replacement file remains untouched and uncontaminated.
    expect(storage.files.get(path)).toBe(replacement);
    expect(storage.files.get(path)).not.toContain('/old-session');
  });

  it('retries migration when replace fails but exact original source bytes remain', async () => {
    const { storage, overlay, store } = harness();
    const path = '.pivi/sessions/retry-source.jsonl';
    const source = [
      header('retry-session'),
      message('u1', null, 'user', 'hello'),
      {
        type: 'custom', id: 'ctx', parentId: 'u1', timestamp: NOW, customType: PIVI_UI_CONTEXT,
        data: { externalContextPaths: ['/session'] },
      },
    ].map(line).join('');
    storage.files.set(path, source);

    let attempts = 0;
    storage.replaceHooks.push(async () => {
      attempts += 1;
      if (attempts === 1) {
        // Replace did not land; source bytes unchanged.
        throw new SessionRevisionError(path);
      }
    });

    expect(await store.migrateDeviceLocalExternalContexts()).toBe(1);
    expect(attempts).toBe(2);
    expect(overlay.getSessionPaths(path)).toEqual(['/session']);
    expect(storage.files.get(path)).not.toContain('/session');
  });
});

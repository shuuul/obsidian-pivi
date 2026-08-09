import type { AgentMessage } from '@earendil-works/pi-agent-core';
import type { SessionEntry } from '@earendil-works/pi-coding-agent';

import type { ImageAttachment } from '@pivi/pivi-agent-core/foundation';
import type {
  SessionContentRevision,
  SessionJsonlSnapshot,
  SessionJsonlStorage,
} from '@pivi/pivi-agent-core/engine/pi/session/sessionJsonlStorage';
import {
  SessionRevisionError,
  SessionWriteUncertainError,
} from '@pivi/pivi-agent-core/engine/pi/session/sessionJsonlStorage';
import { VaultPiSessionTreeFactory } from '@pivi/pivi-agent-core/engine/pi/session/vaultPiSessionTree';

const NOW = '2026-08-09T12:34:56.789Z';

class MemoryStorage implements SessionJsonlStorage {
  readonly files = new Map<string, string>();
  appendError?: Error;
  appendCalls = 0;

  async list() { return [...this.files.keys()].map(path => ({ path })); }
  async read(path: string) { return this.snapshot(path, this.files.get(path) ?? ''); }
  async create(path: string, content: string) {
    if (this.files.has(path)) throw new Error('collision');
    this.files.set(path, content);
    return this.snapshot(path, content);
  }
  async append(path: string, content: string, expected: SessionContentRevision) {
    this.appendCalls++;
    if (this.appendError) throw this.appendError;
    const before = await this.read(path);
    if (JSON.stringify(before.revision) !== JSON.stringify(expected)) throw new SessionRevisionError(path);
    this.files.set(path, before.content + content);
    return this.read(path);
  }
  async replace(path: string, content: string, expected: SessionContentRevision) {
    const before = await this.read(path);
    if (JSON.stringify(before.revision) !== JSON.stringify(expected)) throw new SessionRevisionError(path);
    this.files.set(path, content);
    return this.read(path);
  }
  async delete(path: string) { this.files.delete(path); }

  private snapshot(path: string, content: string): SessionJsonlSnapshot {
    return { path, content, revision: { bytes: new TextEncoder().encode(content).byteLength, sha256: content } };
  }
}

function deterministicFactory(storage = new MemoryStorage()) {
  let session = 0;
  let entry = 0;
  const factory = new VaultPiSessionTreeFactory(storage, {
    now: () => NOW,
    sessionId: () => `session-${++session}`,
    entryId: existing => {
      let id: string;
      do id = (++entry).toString(16).padStart(8, '0'); while (existing.has(id));
      return id;
    },
  });
  return { storage, factory };
}

function line(value: unknown): string { return `${JSON.stringify(value)}\n`; }

describe('VaultPiSessionTree', () => {
  it('creates and opens a Pi-compatible session with unique IDs and matching filename', async () => {
    const { storage, factory } = deterministicFactory();
    const first = await factory.create();
    const second = await factory.create();
    expect(first.getSessionId()).toBe('session-1');
    expect(first.getSessionFile()).toContain('_session-1.jsonl');
    expect(second.getSessionFile()).toContain('_session-2.jsonl');
    expect((await factory.open(first.getSessionFile())).getSessionId()).toBe(first.getSessionId());
    expect(JSON.parse(storage.files.get(first.getSessionFile())!.split('\n')[0]!)).toEqual({
      type: 'session', version: 3, id: 'session-1', timestamp: NOW, cwd: '',
    });
  });

  it('terminally tombstones a created tree discarded before runtime publication', async () => {
    const { storage, factory } = deterministicFactory();
    const tree = await factory.create();

    await factory.discardCreated(tree);

    expect(storage.files.get(tree.getSessionFile())).toContain('"customType":"pivi/session-deleted"');
    const reopened = await factory.open(tree.getSessionFile());
    await expect(reopened.appendUserMessage('late')).rejects.toBeInstanceOf(SessionRevisionError);
  });

  it('appends exact-prefix user, custom, and agent records with Unicode and images', async () => {
    const { storage, factory } = deterministicFactory();
    const tree = await factory.create();
    const prefix = storage.files.get(tree.getSessionFile())!;
    const image: ImageAttachment = {
      id: 'image-1', name: '雪.png', mediaType: 'image/png', size: 3,
      data: 'AQID', source: 'file',
    };
    const userId = await tree.appendUserMessage('你好 👋', [image]);
    const customId = await tree.appendCustomMeta({ title: '雪', createdAt: 1 });
    await tree.syncAgentMessages([
      tree.loadAgentMessages()[0]!,
      { role: 'assistant', content: [{ type: 'text', text: '完成' }], timestamp: 2 } as AgentMessage,
    ]);
    const content = storage.files.get(tree.getSessionFile())!;
    expect(content.startsWith(prefix)).toBe(true);
    expect(tree.getEntries().map(entry => entry.id)).toEqual([userId, customId, '00000003']);
    expect(content).toContain('你好 👋');
    expect(content).toContain('"type":"image","data":"AQID"');
    expect(tree.getEntries().map(entry => entry.parentId)).toEqual([null, userId, customId]);
  });

  it('reuses one live tree and serializes concurrent mutation planning', async () => {
    const { factory } = deterministicFactory();
    const tree = await factory.create();

    await expect(factory.open(tree.getSessionFile())).resolves.toBe(tree);
    const ids = await Promise.all([
      tree.appendUserMessage('first'),
      tree.appendUserMessage('second'),
    ]);

    expect(ids).toEqual(['00000001', '00000002']);
    expect(tree.getEntries().map(entry => entry.parentId)).toEqual([null, '00000001']);
  });

  it('commits a user message and its UI overlay in one append', async () => {
    const { storage, factory } = deterministicFactory();
    const tree = await factory.create();
    const before = storage.appendCalls;

    const userId = await tree.appendUserTurn('prompt', undefined, { displayContent: '/visible' });

    expect(storage.appendCalls).toBe(before + 1);
    expect(tree.getEntries()).toEqual([
      expect.objectContaining({ id: userId, type: 'message' }),
      expect.objectContaining({
        type: 'custom',
        data: expect.objectContaining({ targetEntryId: userId, displayContent: '/visible' }),
      }),
    ]);
  });

  it('does not publish either user-turn record when the atomic append fails', async () => {
    const { storage, factory } = deterministicFactory();
    const tree = await factory.create();
    storage.appendError = new Error('atomic append failed');

    await expect(tree.appendUserTurn('prompt', undefined, { displayContent: '/visible' }))
      .rejects.toThrow('atomic append failed');

    expect(tree.getEntries()).toEqual([]);
    expect(storage.files.get(tree.getSessionFile())!.trim().split('\n')).toHaveLength(1);
  });

  it.each(['failed', 'uncertain'])('%s append does not advance leaf or held revision', async kind => {
    const { storage, factory } = deterministicFactory();
    const tree = await factory.create();
    const beforeLeaf = tree.getLeafId();
    storage.appendError = new Error(kind);
    await expect(tree.appendUserMessage('not durable')).rejects.toThrow(kind);
    expect(tree.getLeafId()).toBe(beforeLeaf);
    expect(tree.getEntries()).toHaveLength(0);
    storage.appendError = undefined;
    const id = await tree.appendUserMessage('durable');
    expect(id).toBe('00000002');
  });

  it('rejects stale source before mutation', async () => {
    const { storage, factory } = deterministicFactory();
    const tree = await factory.create();
    storage.files.set(tree.getSessionFile(), `${storage.files.get(tree.getSessionFile())!}${line({ external: true })}`);
    await expect(tree.appendUserMessage('stale')).rejects.toBeInstanceOf(SessionRevisionError);
    expect(tree.getLeafId()).toBeNull();
  });

  it('makes an uncertain tree fail-stop after reopening a replacement tree', async () => {
    const { storage, factory } = deterministicFactory();
    const oldTree = await factory.create();
    storage.appendError = new SessionWriteUncertainError(oldTree.getSessionFile());

    await expect(oldTree.appendUserMessage('uncertain'))
      .rejects.toBeInstanceOf(SessionWriteUncertainError);

    storage.appendError = undefined;
    const replacement = await factory.open(oldTree.getSessionFile());
    expect(replacement).not.toBe(oldTree);
    await expect(oldTree.appendUserMessage('must not write'))
      .rejects.toBeInstanceOf(SessionRevisionError);
    await expect(replacement.appendUserMessage('replacement writes')).resolves.toBe('00000002');
  });

  it('truncates and forks a rechained branch under a new filename/session ID', async () => {
    const { factory } = deterministicFactory();
    const tree = await factory.create();
    const first = await tree.appendUserMessage('first');
    await tree.appendUserMessage('second');
    expect(await tree.truncateAfter(first)).toBe(true);
    expect(tree.getLeafId()).toBe(first);
    expect(await tree.truncateAfter('missing')).toBe(false);
    const fork = await tree.forkToNewTree(first);
    expect(fork).not.toBeNull();
    expect(fork!.getSessionId()).toBe('session-2');
    expect(fork!.getSessionFile()).toContain('_session-2.jsonl');
    expect(fork!.getEntries().map(entry => entry.id)).toEqual([first]);
  });

  it('treats tombstone as terminal and rejects later mutation, truncate, and fork', async () => {
    const { factory } = deterministicFactory();
    const tree = await factory.create();
    const first = await tree.appendUserMessage('keep');
    await tree.appendSessionDeleted!(Date.parse(NOW));

    await expect(tree.appendUserMessage('after tombstone')).rejects.toBeInstanceOf(SessionRevisionError);
    await expect(tree.truncateAfter(first)).rejects.toBeInstanceOf(SessionRevisionError);
    await expect(tree.forkToNewTree(first)).rejects.toBeInstanceOf(SessionRevisionError);
    await expect(tree.appendSessionDeleted!(Date.parse(NOW))).rejects.toBeInstanceOf(SessionRevisionError);
  });

  it('rejects fork when source revision goes stale before create', async () => {
    const { storage, factory } = deterministicFactory();
    const tree = await factory.create();
    const first = await tree.appendUserMessage('keep');
    const originalRead = storage.read.bind(storage);
    let reads = 0;
    storage.read = async (path: string) => {
      const snapshot = await originalRead(path);
      reads += 1;
      // First fork-time reread sees an externally rewritten source.
      if (reads === 1 && path === tree.getSessionFile()) {
        return {
          ...snapshot,
          content: `${snapshot.content}${line({ external: true })}`,
          revision: {
            bytes: snapshot.revision.bytes + 20,
            sha256: `${snapshot.revision.sha256}-stale`,
          },
        };
      }
      return snapshot;
    };

    await expect(tree.forkToNewTree(first)).rejects.toBeInstanceOf(SessionRevisionError);
    expect([...storage.files.keys()].filter(path => path !== tree.getSessionFile())).toEqual([]);
  });

  it('invalidates a pending open when forget bumps the path epoch', async () => {
    const { storage, factory } = deterministicFactory();
    const tree = await factory.create();
    const path = tree.getSessionFile();
    factory.forget(path);

    let releaseRead!: () => void;
    const gate = new Promise<void>(resolve => { releaseRead = resolve; });
    const originalRead = storage.read.bind(storage);
    storage.read = async (file: string) => {
      if (file === path) await gate;
      return originalRead(file);
    };

    const pending = factory.open(path);
    // forget while open is blocked on storage.read
    factory.forget(path);
    releaseRead();

    await expect(pending).rejects.toBeInstanceOf(SessionRevisionError);
    storage.read = originalRead;
    const replacement = await factory.open(path);
    expect(replacement).not.toBe(tree);
    await expect(tree.appendUserMessage('stale live tree')).rejects.toBeInstanceOf(SessionRevisionError);
    await expect(replacement.appendUserMessage('fresh')).resolves.toMatch(/^[0-9a-f]+$/);
  });

  it('terminally epoch-bumps on successful tombstone so a pending pre-tombstone open cannot cache old bytes', async () => {
    const { storage, factory } = deterministicFactory();
    const tree = await factory.create();
    const path = tree.getSessionFile();
    await tree.appendUserMessage('keep');

    // Open starts first and captures the pre-tombstone epoch while blocked on read.
    let releaseRead!: () => void;
    const readGate = new Promise<void>(resolve => { releaseRead = resolve; });
    let resolveReadEntered!: () => void;
    const readEntered = new Promise<void>(resolve => { resolveReadEntered = resolve; });
    let firstRead = true;
    const originalRead = storage.read.bind(storage);
    storage.read = async (file: string) => {
      if (file === path && firstRead) {
        firstRead = false;
        resolveReadEntered();
        await readGate;
      }
      return originalRead(file);
    };

    const pendingOpen = factory.open(path);
    await readEntered;

    // Successful tombstone terminal-forgets (epoch bump) while open still holds the old epoch.
    await tree.appendSessionDeleted!(Date.parse(NOW));
    releaseRead();

    await expect(pendingOpen).rejects.toBeInstanceOf(SessionRevisionError);
    storage.read = originalRead;

    const reopened = await factory.open(path);
    expect(reopened).not.toBe(tree);
    expect(reopened.getEntries().some(entry => (
      entry.type === 'custom' && entry.customType === 'pivi/session-deleted'
    ))).toBe(true);
    await expect(tree.appendUserMessage('stale pre-tombstone tree')).rejects.toBeInstanceOf(SessionRevisionError);
    await expect(reopened.appendUserMessage('after reopen')).rejects.toBeInstanceOf(SessionRevisionError);
  });

  it('ordinary stale invalidation drops the live tree without bumping the path epoch', async () => {
    const { storage, factory } = deterministicFactory();
    const tree = await factory.create();
    const path = tree.getSessionFile();

    storage.appendError = new SessionRevisionError(path);
    await expect(tree.appendUserMessage('stale')).rejects.toBeInstanceOf(SessionRevisionError);
    storage.appendError = undefined;

    // No epoch bump: a concurrent open that started before invalidate can still complete
    // and a fresh open after ordinary invalidation succeeds without SessionRevisionError from epoch.
    const replacement = await factory.open(path);
    expect(replacement).not.toBe(tree);
    await expect(replacement.appendUserMessage('fresh')).resolves.toMatch(/^[0-9a-f]+$/);
  });

  it('persists full replacement boundary before compaction with matching checkpoint details', async () => {
    const { storage, factory } = deterministicFactory();
    const tree = await factory.create();
    const first = await tree.appendUserMessage('old');
    const result = await tree.appendFullReplacementCompaction(50, boundaryId => ({
      schemaVersion: 1,
      continuationSummary: 'Continue.', goal: null, constraints: [], decisions: [], artifacts: [],
      openWork: [], unresolvedQuestions: [], nextSteps: [],
      source: { firstEntryId: first, lastEntryId: first, firstKeptEntryId: boundaryId },
      tokenEstimates: { contextBefore: 50, checkpoint: 5 },
    }), checkpoint => `NOTE₂ ${checkpoint.source.firstKeptEntryId}`);
    const tail = tree.getEntries().slice(-2);
    expect(tail.map(entry => entry.type)).toEqual(['custom', 'compaction']);
    expect(tail.map(entry => entry.id)).toEqual([result.boundaryId, result.compactionId]);
    expect(tail[1]).toMatchObject({
      parentId: result.boundaryId,
      firstKeptEntryId: result.boundaryId,
      details: { piviCheckpoint: { source: { firstKeptEntryId: result.boundaryId } } },
    });
    const records = storage.files.get(tree.getSessionFile())!.trim().split('\n')
      .map(record => JSON.parse(record) as Record<string, unknown>);
    expect(records.slice(-2).map(record => record.id)).toEqual([result.boundaryId, result.compactionId]);
  });

  it('does not write or advance revision for an idempotent agent-sync plan', async () => {
    const { storage, factory } = deterministicFactory();
    const tree = await factory.create();
    await tree.appendUserMessage('same');
    const messages = tree.loadAgentMessages();
    const calls = storage.appendCalls;
    await tree.syncAgentMessages(messages);
    expect(storage.appendCalls).toBe(calls);
    await tree.appendUserMessage('next');
    expect(tree.getLeafId()).toBe('00000002');
  });
});

describe('VaultPiSessionTree differential semantics', () => {
  const header = { type: 'session', version: 3, id: 'fixture', timestamp: NOW, cwd: '' };
  const message = (id: string, parentId: string | null, role: string, content: unknown): SessionEntry => ({
    type: 'message', id, parentId, timestamp: NOW, message: { role, content, timestamp: 1 },
  } as SessionEntry);

  it.each([
    'branched input and trailing custom',
    'trailing compaction and branch summary',
    'tool result and null content',
  ])('matches pinned Pi projections for %s', async scenario => {
    const entries: SessionEntry[] = scenario.startsWith('branched') ? [
      message('u1', null, 'user', 'one'), message('a1', 'u1', 'assistant', 'answer'),
      message('u2', 'u1', 'user', 'branch'),
      { type: 'custom', id: 'tail', parentId: 'u2', timestamp: NOW, customType: 'tail' } as SessionEntry,
    ] : scenario.startsWith('trailing') ? [
      message('u1', null, 'user', 'old'),
      { type: 'branch_summary', id: 'bs', parentId: 'u1', timestamp: NOW, summary: 'branch', fromId: 'x' } as SessionEntry,
      message('a1', 'bs', 'assistant', 'answer'),
      { type: 'compaction', id: 'c1', parentId: 'a1', timestamp: NOW, summary: 'summary', firstKeptEntryId: 'a1', tokensBefore: 2 } as SessionEntry,
    ] : [
      message('u1', null, 'user', null),
      message('t1', 'u1', 'toolResult', null),
      message('a1', 't1', 'assistant', null),
    ];
    const storage = new MemoryStorage();
    const source = [header, ...entries].map(line).join('');
    storage.files.set('.pivi/sessions/fixture.jsonl', source);
    const tree = await deterministicFactory(storage).factory.open('.pivi/sessions/fixture.jsonl');

    expect(tree.getLinearVisiblePrefix().map(entry => entry.id)).toEqual(
      scenario.startsWith('branched') ? ['u1', 'a1', 'u2'] : entries.map(entry => entry.id),
    );
    expect(tree.getLinearLlmContextEntries().map(entry => entry.id)).toEqual(
      scenario.startsWith('branched') ? ['u1', 'a1', 'u2'] : entries.map(entry => entry.id),
    );
    expect(tree.findLastVisibleMessageEntryId('user')).toBe(
      scenario.startsWith('branched') ? 'u2' : 'u1',
    );
    expect(tree.loadAgentMessages().every(value => value !== undefined)).toBe(true);
    const expectedActive = scenario.startsWith('trailing') ? ['c1', 'a1']
      : tree.getLinearLlmContextEntries().map(entry => entry.id);
    expect(tree.getActiveLlmContextEntries().map(entry => entry.id)).toEqual(expectedActive);
    const expectedRoles = scenario.startsWith('trailing') ? ['user', 'assistant']
      : entries.filter(entry => entry.type === 'message').map(entry => entry.message.role);
    expect(tree.loadAgentMessages().map(value => value.role)).toEqual(expectedRoles);
    const nullContents = scenario.startsWith('tool')
      ? tree.loadAgentMessages().map(value => (value as { content: unknown }).content) : null;
    expect(nullContents).toEqual(scenario.startsWith('tool') ? [[], [], []] : null);
  });

  it('applies the same terminal async subagent-result overlay used by SessionTreeStore', async () => {
    const toolResult = {
      role: 'toolResult', toolName: 'spawn_agent', toolCallId: 'call-1',
      content: [{ type: 'text', text: 'Background task started.' }], timestamp: 1,
    } as AgentMessage;
    const user = message('user', null, 'user', 'run');
    const call = message('call', 'user', 'assistant', [{
      type: 'toolCall', id: 'call-1', name: 'spawn_agent', arguments: {},
    }]);
    const resultEntry = {
      ...message('result', 'call', 'toolResult', (toolResult as { content: unknown }).content),
      message: toolResult,
    };
    const assistant = message('assistant', 'result', 'assistant', 'ack');
    const overlay = {
      type: 'custom', id: 'ui', parentId: 'assistant', timestamp: NOW, customType: 'pivi/message-ui',
      data: { toolCalls: [{
        id: 'call-1', result: 'Finished work',
        subagent: { mode: 'async', status: 'completed', asyncStatus: 'completed', agentId: 'agent-1' },
      }] },
    } as SessionEntry;
    const storage = new MemoryStorage();
    storage.files.set('.pivi/sessions/overlay.jsonl',
      [header, user, call, resultEntry, assistant, overlay].map(line).join(''));
    const tree = await deterministicFactory(storage).factory.open('.pivi/sessions/overlay.jsonl');

    expect(tree.loadAgentMessages()[2]).toEqual({
      ...toolResult,
      content: [{ type: 'text', text: 'Background sub-agent agent-1 completed.\n\nFinished work' }],
      isError: false,
    });
  });
});

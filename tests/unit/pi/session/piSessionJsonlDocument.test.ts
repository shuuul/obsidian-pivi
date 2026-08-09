import type { AgentMessage } from '@earendil-works/pi-agent-core';

import {
  PiSessionJsonlDocument,
  PiSessionJsonlError,
  StalePiSessionPlanError,
} from '@pivi/pivi-agent-core/engine/pi/session/piSessionJsonlDocument';

const header = { type: 'session', version: 3, id: 'session-1', timestamp: '2026-01-01T00:00:00.000Z', cwd: '/vault' };
const line = (value: unknown): string => `${JSON.stringify(value)}\n`;

function factories(ids = ['one', 'two', 'three', 'four']) {
  let index = 0;
  return {
    now: () => '2026-02-03T04:05:06.000Z',
    entryId: () => ids[index++]!,
    sessionId: () => 'fork-session',
  };
}

describe('PiSessionJsonlDocument', () => {
  it('preserves source bytes and plans exact CJK/emoji/image/custom/compaction JSONL', () => {
    const source = `  ${JSON.stringify(header)}  \n`;
    const document = PiSessionJsonlDocument.parse(source, { ...factories(), revision: 'etag-1' });
    const user = document.planUserMessage([
      { type: 'text', text: '你好 👋' },
      { type: 'image', data: 'AQID', mimeType: 'image/png' },
    ], 42);

    expect(document.sourceContent).toBe(source);
    expect(document.sourceRevision).toBe('etag-1');
    expect(document.entries).toHaveLength(0);
    expect(user.appendBytes).toBe(line({
      type: 'message', id: 'one', parentId: null,
      timestamp: '2026-02-03T04:05:06.000Z',
      message: { role: 'user', content: [
        { type: 'text', text: '你好 👋' },
        { type: 'image', data: 'AQID', mimeType: 'image/png' },
      ], timestamp: 42 },
    }));
    document.apply(user);

    const custom = document.planCustom('plugin/state', { emoji: '🧭' });
    expect(custom.appendBytes).toBe(line({
      type: 'custom', customType: 'plugin/state', data: { emoji: '🧭' }, id: 'two',
      parentId: 'one', timestamp: '2026-02-03T04:05:06.000Z',
    }));
    document.apply(custom);

    const compact = document.planCompaction('摘要', 'one', 123, { checkpoint: true });
    expect(compact.appendBytes).toBe(line({
      type: 'compaction', id: 'three', parentId: 'two',
      timestamp: '2026-02-03T04:05:06.000Z', summary: '摘要',
      firstKeptEntryId: 'one', tokensBefore: 123, details: { checkpoint: true },
    }));
  });

  it('omits optional compaction and custom data fields exactly like JSON.stringify', () => {
    const document = PiSessionJsonlDocument.parse(line(header), factories());
    expect(document.planCustom('empty').appendBytes).not.toContain('"data"');
    expect(document.planCompaction('summary', 'one', 1).appendBytes)
      .not.toMatch(/"details"|"usage"|"fromHook"/);
  });

  it('rejects a stale plan without changing live state', () => {
    const document = PiSessionJsonlDocument.parse(line(header), factories());
    const stale = document.planUserMessage('stale', 1);
    const winning = document.planUserMessage('winner', 2);
    document.apply(winning);
    expect(() => document.apply(stale)).toThrow(StalePiSessionPlanError);
    expect(document.entries.map(entry => entry.id)).toEqual(['two']);
  });

  it('uses missingAgentMessages for idempotent agent synchronization', () => {
    const document = PiSessionJsonlDocument.parse(line(header), factories());
    const user = { role: 'user', content: 'hello', timestamp: 1 } as AgentMessage;
    document.apply(document.planMessage(user));
    const assistant = {
      role: 'assistant', content: [], provider: 'p', model: 'm', api: 'x',
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      stopReason: 'stop', timestamp: 2,
    } as AgentMessage;
    const plan = document.planAgentMessageSync([user, assistant]);
    expect(plan.entries).toHaveLength(1);
    expect((plan.entries[0] as { message: AgentMessage }).message).toBe(assistant);
  });

  it('plans truncate and fork without mutation and rechains the exact branch', () => {
    const a = { type: 'custom', customType: 'a', data: 1, id: 'a', parentId: null, timestamp: 't1' };
    const b = { type: 'custom', customType: 'b', data: 2, id: 'b', parentId: 'a', timestamp: 't2' };
    const side = { type: 'custom', customType: 'side', data: 3, id: 'side', parentId: 'a', timestamp: 't3' };
    const document = PiSessionJsonlDocument.parse([header, a, b, side].map(line).join(''), factories());

    const truncate = document.planTruncate('b');
    expect(truncate.entries.map(entry => entry.id)).toEqual(['a', 'b']);
    expect(document.entries).toHaveLength(3);

    const fork = document.planFork('side', '/new-vault', '.pivi/sessions/source.jsonl');
    expect(fork.header).toEqual({
      type: 'session', version: 3, id: 'fork-session',
      timestamp: '2026-02-03T04:05:06.000Z', cwd: '/new-vault',
      parentSession: '.pivi/sessions/source.jsonl',
    });
    expect(fork.entries).toEqual([{ ...a, parentId: null }, { ...side, parentId: 'a' }]);
  });

  it.each([
    ['', PiSessionJsonlError],
    [`${line(header)}{bad}\n`, PiSessionJsonlError],
    [[header,
      { type: 'custom', id: 'x', parentId: null, timestamp: 't', customType: 'a' },
      { type: 'custom', id: 'x', parentId: null, timestamp: 't', customType: 'b' }].map(line).join(''), PiSessionJsonlError],
    [[header, { type: 'custom', id: 'x', parentId: 'missing', timestamp: 't', customType: 'a' }].map(line).join(''), PiSessionJsonlError],
    [[header,
      { type: 'custom', id: 'x', parentId: 'y', timestamp: 't', customType: 'a' },
      { type: 'custom', id: 'y', parentId: 'x', timestamp: 't', customType: 'b' }].map(line).join(''), PiSessionJsonlError],
  ])('strictly rejects invalid JSONL %#', (source, ErrorType) => {
    expect(() => PiSessionJsonlDocument.parse(source)).toThrow(ErrorType);
  });

  it('migrates v2 hook messages to v3 without Node SessionManager', () => {
    const source = [
      { ...header, version: 2 },
      { type: 'message', id: 'old', parentId: null, timestamp: 't', message: { role: 'hookMessage', content: [] } },
    ].map(line).join('');
    const document = PiSessionJsonlDocument.parse(source);
    expect(document.migrationRequired).toBe(true);
    expect(document.header.version).toBe(3);
    expect((document.entries[0] as { message: { role: string } }).message.role).toBe('custom');
  });

  it('keeps the original byte prefix untouched for append persistence', () => {
    const source = ` ${JSON.stringify(header)} \r\n`;
    const document = PiSessionJsonlDocument.parse(source, factories());
    const append = document.planUserMessage('next', 1);
    expect(`${source}${append.appendBytes}`.slice(0, source.length)).toBe(source);
  });
});

import fs from 'fs';
import os from 'os';
import path from 'path';

import {
  openRecentSessionJsonlMessages,
  readOlderSessionJsonlMessages,
} from '@pivi/pivi-agent-core/engine/pi/session/sessionJsonlRangeReader';
import {
  invalidateSessionJsonlIndex,
} from '@pivi/pivi-agent-core/engine/pi/session/sessionJsonlIndex';
import {
  SessionIndexStaleError,
  SessionRangeCursorError,
} from '@pivi/pivi-agent-core/session';

function jsonl(value: unknown): string {
  return `${JSON.stringify(value)}\n`;
}

function message(
  id: string,
  role: 'user' | 'assistant' | 'toolResult',
  content: string,
  parentId: string | null,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    type: 'message',
    id,
    parentId,
    timestamp: '2026-01-01T00:00:01.000Z',
    message: {
      role,
      content,
      timestamp: 1,
      ...extra,
    },
  };
}

describe('sessionJsonlRangeReader', () => {
  let root: string;
  let sessionFile: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'pivi-session-range-'));
    sessionFile = path.join(root, 'session.jsonl');
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('reads a bounded recent page from a 5K-message session', () => {
    const lines = [jsonl({
      type: 'session',
      version: 3,
      id: 'session-1',
      timestamp: '2026-01-01T00:00:00.000Z',
      cwd: root,
    })];
    let parentId: string | null = null;
    for (let index = 0; index < 5_000; index++) {
      const id = `message-${index}`;
      const role = index % 2 === 0 ? 'user' : 'assistant';
      lines.push(jsonl(message(id, role, `content ${index}`, parentId)));
      parentId = id;
    }
    fs.writeFileSync(sessionFile, lines.join(''));

    const page = openRecentSessionJsonlMessages(sessionFile, 100);

    expect(page.messages).toHaveLength(100);
    expect(page.messages[0]?.id).toBe('message-4900');
    expect(page.messages.at(-1)?.id).toBe('message-4999');
    expect(page.hasOlder).toBe(true);
    expect(page.totalMessageCount).toBe(5_000);
    expect(page.olderUserMessageCount).toBe(2_450);
    expect(page.stats.entryCount).toBe(100);
    expect(page.stats.byteCount).toBeLessThan(fs.statSync(sessionFile).size / 20);
  });

  it('includes the preceding user when a bounded page would start on an assistant', () => {
    fs.writeFileSync(sessionFile, [
      jsonl({ type: 'session', version: 3, id: 'session-1', timestamp: '2026-01-01T00:00:00.000Z', cwd: root }),
      jsonl(message('user-1', 'user', 'one', null)),
      jsonl(message('assistant-1', 'assistant', 'two', 'user-1')),
      jsonl(message('user-2', 'user', 'three', 'assistant-1')),
      jsonl(message('assistant-2', 'assistant', 'four', 'user-2')),
      jsonl(message('user-3', 'user', 'five', 'assistant-2')),
      jsonl(message('assistant-3', 'assistant', 'six', 'user-3')),
    ].join(''));

    const page = openRecentSessionJsonlMessages(sessionFile, 3);

    expect(page.messages.map((entry) => entry.id)).toEqual([
      'user-2',
      'assistant-2',
      'user-3',
      'assistant-3',
    ]);
    expect(page.olderUserMessageCount).toBe(1);
    expect(page.hasOlder).toBe(true);
  });

  it('keeps assistant segments, tool results, and later UI overlays in one page group', () => {
    fs.writeFileSync(sessionFile, [
      jsonl({ type: 'session', version: 3, id: 'session-1', timestamp: '2026-01-01T00:00:00.000Z', cwd: root }),
      jsonl(message('user-1', 'user', '<query>hello</query>', null)),
      jsonl(message('assistant-1', 'assistant', '', 'user-1', {
        content: [{ type: 'toolCall', id: 'tool-1', name: 'read', arguments: {} }],
      })),
      jsonl(message('tool-result-1', 'toolResult', 'done', 'assistant-1', { toolCallId: 'tool-1' })),
      jsonl(message('assistant-2', 'assistant', 'finished', 'tool-result-1')),
      jsonl({
        type: 'custom',
        customType: 'pivi/message-ui',
        id: 'ui-1',
        parentId: 'assistant-2',
        timestamp: '2026-01-01T00:00:02.000Z',
        data: { targetEntryId: 'assistant-2', durationSeconds: 3 },
      }),
    ].join(''));

    const page = openRecentSessionJsonlMessages(sessionFile, 1);

    expect(page.totalMessageCount).toBe(2);
    expect(page.messages).toEqual([
      expect.objectContaining({ id: 'user-1' }),
      expect.objectContaining({
        id: 'assistant-1',
        content: 'finished',
        assistantMessageId: 'assistant-2',
        durationSeconds: 3,
        toolCalls: [expect.objectContaining({ id: 'tool-1', result: 'done', status: 'completed' })],
      }),
    ]);
    expect(page.stats.entryCount).toBe(5);
  });

  it('keeps a trailing tool result in the final assistant group', () => {
    fs.writeFileSync(sessionFile, [
      jsonl({ type: 'session', version: 3, id: 'session-1', timestamp: '2026-01-01T00:00:00.000Z', cwd: root }),
      jsonl(message('user-1', 'user', 'hello', null)),
      jsonl(message('assistant-1', 'assistant', '', 'user-1', {
        content: [{ type: 'toolCall', id: 'tool-1', name: 'read', arguments: {} }],
      })),
      jsonl(message('tool-result-1', 'toolResult', 'done', 'assistant-1', { toolCallId: 'tool-1' })),
    ].join(''));

    const page = openRecentSessionJsonlMessages(sessionFile, 1);

    expect(page.messages).toEqual([
      expect.objectContaining({ id: 'user-1' }),
      expect.objectContaining({
        id: 'assistant-1',
        toolCalls: [expect.objectContaining({
          id: 'tool-1',
          result: 'done',
          status: 'completed',
        })],
      }),
    ]);
  });

  it('pages older messages by the first projected message id', () => {
    fs.writeFileSync(sessionFile, [
      jsonl({ type: 'session', version: 3, id: 'session-1', timestamp: '2026-01-01T00:00:00.000Z', cwd: root }),
      jsonl(message('user-1', 'user', 'one', null)),
      jsonl(message('assistant-1', 'assistant', 'two', 'user-1')),
      jsonl(message('user-2', 'user', 'three', 'assistant-1')),
      jsonl(message('assistant-2', 'assistant', 'four', 'user-2')),
    ].join(''));

    const page = readOlderSessionJsonlMessages(sessionFile, 'user-2', 2);

    expect(page.messages.map((entry) => entry.id)).toEqual(['user-1', 'assistant-1']);
    expect(page.hasOlder).toBe(false);
    expect(page.totalMessageCount).toBe(4);
    expect(page.olderUserMessageCount).toBe(0);
  });

  it('folds adjacent duplicate pending users using later display overlays', () => {
    fs.writeFileSync(sessionFile, [
      jsonl({ type: 'session', version: 3, id: 'session-1', timestamp: '2026-01-01T00:00:00.000Z', cwd: root }),
      jsonl(message('user-expanded-1', 'user', 'expanded first', null)),
      jsonl({
        type: 'custom',
        customType: 'pivi/message-ui',
        id: 'ui-1',
        parentId: 'user-expanded-1',
        timestamp: '2026-01-01T00:00:02.000Z',
        data: { targetEntryId: 'user-expanded-1', displayContent: '/tests' },
      }),
      jsonl(message('user-expanded-2', 'user', 'expanded second', 'ui-1')),
      jsonl({
        type: 'custom',
        customType: 'pivi/message-ui',
        id: 'ui-2',
        parentId: 'user-expanded-2',
        timestamp: '2026-01-01T00:00:03.000Z',
        data: { targetEntryId: 'user-expanded-2', displayContent: ' /tests  ' },
      }),
    ].join(''));

    const page = openRecentSessionJsonlMessages(sessionFile, 10);

    expect(page.totalMessageCount).toBe(1);
    expect(page.messages).toEqual([expect.objectContaining({
      id: 'user-expanded-2',
      displayContent: ' /tests  ',
    })]);
  });

  it('fails explicitly when the older-page cursor is unknown', () => {
    fs.writeFileSync(sessionFile, [
      jsonl({ type: 'session', version: 3, id: 'session-1', timestamp: '2026-01-01T00:00:00.000Z', cwd: root }),
      jsonl(message('user-1', 'user', 'one', null)),
    ].join(''));

    expect(() => readOlderSessionJsonlMessages(sessionFile, 'missing', 10))
      .toThrow(SessionRangeCursorError);
  });

  it('rebuilds a stale read index before returning a partial page', () => {
    fs.writeFileSync(sessionFile, [
      jsonl({ type: 'session', version: 3, id: 'session-1', timestamp: '2026-01-01T00:00:00.000Z', cwd: root }),
      jsonl(message('user-1', 'user', 'one', null)),
      jsonl(message('assistant-1', 'assistant', 'two', 'user-1')),
    ].join(''));
    openRecentSessionJsonlMessages(sessionFile, 1);
    const changed = fs.readFileSync(sessionFile, 'utf8').replace('"two"', '"six"');
    fs.writeFileSync(sessionFile, changed);

    expect(openRecentSessionJsonlMessages(sessionFile, 1).messages.at(-1)?.content).toBe('six');
  });

  it('rebuilds bounded pages after truncate and for a forked prefix', () => {
    const header = jsonl({
      type: 'session', version: 3, id: 'session-1', timestamp: '2026-01-01T00:00:00.000Z', cwd: root,
    });
    const entries = [
      jsonl(message('user-1', 'user', 'one', null)),
      jsonl(message('assistant-1', 'assistant', 'two', 'user-1')),
      jsonl(message('user-2', 'user', 'three', 'assistant-1')),
      jsonl(message('assistant-2', 'assistant', 'four', 'user-2')),
    ];
    fs.writeFileSync(sessionFile, [header, ...entries].join(''));
    expect(openRecentSessionJsonlMessages(sessionFile, 2).totalMessageCount).toBe(4);

    fs.writeFileSync(sessionFile, [header, ...entries.slice(0, 2)].join(''));
    invalidateSessionJsonlIndex(sessionFile);
    expect(openRecentSessionJsonlMessages(sessionFile, 10).messages.map(({ id }) => id))
      .toEqual(['user-1', 'assistant-1']);

    const forkFile = path.join(root, 'fork.jsonl');
    fs.writeFileSync(forkFile, [header, ...entries.slice(0, 2)].join(''));
    expect(openRecentSessionJsonlMessages(forkFile, 10).messages.map(({ id }) => id))
      .toEqual(['user-1', 'assistant-1']);
  });

  it('reopens a trailing compaction as the newest Memory boundary', () => {
    fs.writeFileSync(sessionFile, [
      jsonl({ type: 'session', version: 3, id: 'session-1', timestamp: '2026-01-01T00:00:00.000Z', cwd: root }),
      jsonl(message('user-1', 'user', 'one', null)),
      jsonl(message('assistant-1', 'assistant', 'two', 'user-1')),
      jsonl({
        type: 'compaction',
        id: 'compaction-1',
        parentId: 'assistant-1',
        timestamp: '2026-01-01T00:00:03.000Z',
        summary: 'Earlier context',
        firstKeptEntryId: 'user-1',
        tokensBefore: 10,
      }),
    ].join(''));

    const page = openRecentSessionJsonlMessages(sessionFile, 3);

    expect(page.messages.map(({ id }) => id)).toEqual([
      'user-1',
      'assistant-1',
      'compaction-1',
    ]);
    expect(page.messages.at(-1)?.contentBlocks).toEqual([
      expect.objectContaining({
        type: 'context_compacted',
        summary: 'Earlier context',
      }),
    ]);
    expect(page.totalMessageCount).toBe(3);
    expect(page.stats.entryCount).toBe(3);

    const newest = openRecentSessionJsonlMessages(sessionFile, 1);
    expect(newest).toMatchObject({
      messages: [{ id: 'compaction-1' }],
      hasOlder: true,
      totalMessageCount: 3,
      olderMessageCount: 2,
    });
    expect(readOlderSessionJsonlMessages(sessionFile, 'compaction-1', 2))
      .toMatchObject({
        messages: [{ id: 'user-1' }, { id: 'assistant-1' }],
        hasOlder: false,
        totalMessageCount: 3,
      });
  });
});

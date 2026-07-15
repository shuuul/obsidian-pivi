import fs from 'fs';
import os from 'os';
import path from 'path';

import {
  openRecentSessionJsonlMessages,
  readOlderSessionJsonlMessages,
} from '@pivi/pivi-agent-core/engine/pi/session/sessionJsonlRangeReader';
import { SessionRangeCursorError } from '@pivi/pivi-agent-core/session';

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
    expect(page.stats.entryCount).toBe(100);
    expect(page.stats.byteCount).toBeLessThan(fs.statSync(sessionFile).size / 20);
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
    expect(page.messages).toEqual([expect.objectContaining({
      id: 'assistant-1',
      content: 'finished',
      assistantMessageId: 'assistant-2',
      durationSeconds: 3,
      toolCalls: [expect.objectContaining({ id: 'tool-1', result: 'done', status: 'completed' })],
    })]);
    expect(page.stats.entryCount).toBe(4);
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
});

import type { AgentMessage } from '@earendil-works/pi-agent-core';
import type { SessionEntry } from '@earendil-works/pi-coding-agent/dist/core/session-manager.js';

import {
  collectMessageUiMap,
  entriesToChatMessages,
} from '../../../src/pi/session/MessageMapper';
import { OBSIUS_MESSAGE_UI } from '../../../src/pi/session/obsiusCustomTypes';

describe('MessageMapper', () => {
  it('maps user and assistant message entries with UI overlay', () => {
    const branch: SessionEntry[] = [
      {
        type: 'message',
        id: 'u1',
        parentId: null,
        timestamp: '2026-01-01T00:00:00.000Z',
        message: { role: 'user', content: 'hello', timestamp: 1 } as unknown as AgentMessage,
      },
      {
        type: 'custom',
        id: 'c1',
        parentId: 'u1',
        timestamp: '2026-01-01T00:00:01.000Z',
        customType: OBSIUS_MESSAGE_UI,
        data: { targetEntryId: 'u1', displayContent: '/hi' },
      },
      {
        type: 'message',
        id: 'a1',
        parentId: 'c1',
        timestamp: '2026-01-01T00:00:02.000Z',
        message: { role: 'assistant', content: 'world', timestamp: 2 } as unknown as AgentMessage,
      },
    ];

    const uiMap = collectMessageUiMap(branch);
    const messages = entriesToChatMessages(branch, uiMap);

    expect(messages).toHaveLength(2);
    expect(messages[0].displayContent).toBe('/hi');
    expect(messages[1].content).toBe('world');
  });

  it('derives displayContent from persisted XML when message-ui overlay is missing', () => {
    const persisted = [
      '',
      '<current_note>',
      'inbox/paper/CryoFastAR.md',
      '</current_note>',
      '',
      '<context_files>',
      'inbox/paper/CryoFastAR.md',
      '</context_files>',
    ].join('\n');

    const branch: SessionEntry[] = [
      {
        type: 'message',
        id: 'u1',
        parentId: null,
        timestamp: '2026-01-01T00:00:00.000Z',
        message: { role: 'user', content: persisted, timestamp: 1 } as unknown as AgentMessage,
      },
    ];

    const messages = entriesToChatMessages(branch, new Map());

    expect(messages[0].content).toBe(persisted);
    expect(messages[0].displayContent).toBe('');
  });

  it('reconstructs assistant tool calls and ordered content blocks from JSONL messages', () => {
    const branch: SessionEntry[] = [
      {
        type: 'message',
        id: 'a1',
        parentId: null,
        timestamp: '2026-01-01T00:00:00.000Z',
        message: {
          role: 'assistant',
          content: [
            { type: 'thinking', thinking: 'checking note' },
            { type: 'text', text: 'I will read it.' },
            { type: 'toolCall', id: 'call-1', name: 'obsidian_read', arguments: { path: 'A.md' } },
          ],
          timestamp: 1,
        } as unknown as AgentMessage,
      },
      {
        type: 'message',
        id: 't1',
        parentId: 'a1',
        timestamp: '2026-01-01T00:00:01.000Z',
        message: {
          role: 'toolResult',
          toolCallId: 'call-1',
          toolName: 'obsidian_read',
          content: [{ type: 'text', text: 'contents' }],
          isError: false,
          timestamp: 2,
        } as unknown as AgentMessage,
      },
      {
        type: 'message',
        id: 'a2',
        parentId: 't1',
        timestamp: '2026-01-01T00:00:02.000Z',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'Done.' }],
          timestamp: 3,
        } as unknown as AgentMessage,
      },
    ];

    const messages = entriesToChatMessages(branch, new Map());

    expect(messages).toHaveLength(2);
    expect(messages[0].contentBlocks).toEqual([
      { type: 'thinking', content: 'checking note' },
      { type: 'text', content: 'I will read it.' },
      { type: 'tool_use', toolId: 'call-1' },
    ]);
    expect(messages[0].toolCalls).toEqual([
      {
        id: 'call-1',
        name: 'obsidian_read',
        input: { path: 'A.md' },
        status: 'completed',
        isExpanded: false,
        result: 'contents',
      },
    ]);
    expect(messages[1].content).toBe('Done.');
  });

  it('preserves persisted UI overlay content blocks over reconstructed assistant blocks', () => {
    const branch: SessionEntry[] = [
      {
        type: 'message',
        id: 'a1',
        parentId: null,
        timestamp: '2026-01-01T00:00:00.000Z',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'from agent' }],
          timestamp: 1,
        } as unknown as AgentMessage,
      },
      {
        type: 'custom',
        id: 'c1',
        parentId: 'a1',
        timestamp: '2026-01-01T00:00:01.000Z',
        customType: OBSIUS_MESSAGE_UI,
        data: { targetEntryId: 'a1', contentBlocks: [{ type: 'text', content: 'from ui' }] },
      },
    ];

    const messages = entriesToChatMessages(branch, collectMessageUiMap(branch));

    expect(messages[0].contentBlocks).toEqual([{ type: 'text', content: 'from ui' }]);
  });
});

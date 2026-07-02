import type { AgentMessage } from '@earendil-works/pi-agent-core';
import type { SessionEntry } from '@earendil-works/pi-coding-agent/dist/core/session-manager.js';

import {
  collectMessageUiMap,
  entriesToChatMessages,
} from '@pivi/session/MessageMapper';
import { PIVI_MESSAGE_UI } from '@pivi/session';

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
        customType: PIVI_MESSAGE_UI,
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

    expect(messages).toHaveLength(1);
    expect(messages[0].contentBlocks).toEqual([
      { type: 'thinking', content: 'checking note' },
      { type: 'text', content: 'I will read it.' },
      { type: 'tool_use', toolId: 'call-1' },
      { type: 'text', content: 'Done.' },
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
    expect(messages[0].content).toBe('I will read it.\n\nDone.');
  });

  it('restores structured tool result details for rich tool rendering', () => {
    const details = {
      filePath: 'A.md',
      structuredPatch: [{
        oldStart: 1,
        oldLines: 1,
        newStart: 1,
        newLines: 1,
        lines: ['-old', '+new'],
      }],
    };
    const branch: SessionEntry[] = [
      {
        type: 'message',
        id: 'a1',
        parentId: null,
        timestamp: '2026-01-01T00:00:00.000Z',
        message: {
          role: 'assistant',
          content: [
            {
              type: 'toolCall',
              id: 'call-1',
              name: 'Edit',
              arguments: { file_path: 'A.md', old_string: 'old', new_string: 'new' },
            },
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
          toolName: 'Edit',
          content: [{ type: 'text', text: 'updated A.md' }],
          details,
          isError: false,
          timestamp: 2,
        } as unknown as AgentMessage,
      },
    ];

    const messages = entriesToChatMessages(branch, new Map());

    expect(messages).toHaveLength(1);
    expect(messages[0].toolCalls?.[0]).toMatchObject({
      id: 'call-1',
      status: 'completed',
      result: 'updated A.md',
      toolUseResult: details,
      diffData: {
        filePath: 'A.md',
        stats: { added: 1, removed: 1 },
      },
    });
    expect(messages[0].toolCalls?.[0].diffData?.diffLines).toEqual([
      { type: 'delete', text: 'old', oldLineNum: 1 },
      { type: 'insert', text: 'new', newLineNum: 1 },
    ]);
  });

  it('drops empty provider reasoning blocks around tool-only assistant segments', () => {
    const branch: SessionEntry[] = [
      {
        type: 'message',
        id: 'a1',
        parentId: null,
        timestamp: '2026-01-01T00:00:00.000Z',
        message: {
          role: 'assistant',
          content: [
            { type: 'thinking', thinking: '' },
            { type: 'toolCall', id: 'call-1', name: 'obsidian_list', arguments: {} },
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
          toolName: 'obsidian_list',
          content: [{ type: 'text', text: '[]' }],
          isError: false,
          timestamp: 2,
        } as unknown as AgentMessage,
      },
    ];

    const messages = entriesToChatMessages(branch, new Map());

    expect(messages).toHaveLength(1);
    expect(messages[0].contentBlocks).toEqual([{ type: 'tool_use', toolId: 'call-1' }]);
    expect(messages[0].toolCalls?.[0]).toMatchObject({
      id: 'call-1',
      status: 'completed',
      result: '[]',
    });
  });

  it('keeps markdown list boundaries when merging assistant segments', () => {
    const branch: SessionEntry[] = [
      {
        type: 'message',
        id: 'a1',
        parentId: null,
        timestamp: '2026-01-01T00:00:00.000Z',
        message: { role: 'assistant', content: 'Summary:', timestamp: 1 } as unknown as AgentMessage,
      },
      {
        type: 'message',
        id: 'a2',
        parentId: 'a1',
        timestamp: '2026-01-01T00:00:01.000Z',
        message: {
          role: 'assistant',
          content: '- one\n- two',
          timestamp: 2,
        } as unknown as AgentMessage,
      },
    ];

    const messages = entriesToChatMessages(branch, new Map());

    expect(messages).toHaveLength(1);
    expect(messages[0].content).toBe('Summary:\n\n- one\n- two');
  });

  it('starts a new assistant message after a new user message', () => {
    const branch: SessionEntry[] = [
      {
        type: 'message',
        id: 'a1',
        parentId: null,
        timestamp: '2026-01-01T00:00:00.000Z',
        message: { role: 'assistant', content: [{ type: 'text', text: 'first' }] } as unknown as AgentMessage,
      },
      {
        type: 'message',
        id: 'u1',
        parentId: 'a1',
        timestamp: '2026-01-01T00:00:01.000Z',
        message: { role: 'user', content: 'again' } as unknown as AgentMessage,
      },
      {
        type: 'message',
        id: 'a2',
        parentId: 'u1',
        timestamp: '2026-01-01T00:00:02.000Z',
        message: { role: 'assistant', content: [{ type: 'text', text: 'second' }] } as unknown as AgentMessage,
      },
    ];

    const messages = entriesToChatMessages(branch, new Map());

    expect(messages.map((message) => message.role)).toEqual(['assistant', 'user', 'assistant']);
    expect(messages.map((message) => message.content)).toEqual(['first', 'again', 'second']);
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
        customType: PIVI_MESSAGE_UI,
        data: { targetEntryId: 'a1', contentBlocks: [{ type: 'text', content: 'from ui' }] },
      },
    ];

    const messages = entriesToChatMessages(branch, collectMessageUiMap(branch));

    expect(messages[0].contentBlocks).toEqual([{ type: 'text', content: 'from ui' }]);
  });
});

import type { AgentMessage } from '@earendil-works/pi-agent-core';
import type { SessionEntry } from '@earendil-works/pi-coding-agent';
import type { ChatMessage } from '@pivi/pivi-agent-core/foundation';
import type { Skill } from '@pivi/pivi-agent-core/skills/vault/loadVaultSkills';
import { TOOL_SKILL } from '@pivi/pivi-agent-core/tools';

import {
  applySkillDescriptions,
  collectMessageUiMap,
  entriesToChatMessages,
} from '@pivi/pivi-agent-core/engine/pi/session/messageMapper';
import { PIVI_MESSAGE_UI } from '@pivi/pivi-agent-core/session';

function first<T>(values: readonly T[]): T {
  const value = values[0];
  expect(value).toBeDefined();
  if (value === undefined) throw new Error('Expected a non-empty array');
  return value;
}

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
    expect(first(messages).displayContent).toBe('/hi');
    const secondMessage = messages[1];
    if (secondMessage === undefined) throw new Error('Expected a second message');
    expect(secondMessage.content).toBe('world');
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

    expect(first(messages).content).toBe(persisted);
    expect(first(messages).displayContent).toBe('');
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
    expect(first(messages).contentBlocks).toEqual([
      { type: 'thinking', content: 'checking note' },
      { type: 'text', content: 'I will read it.' },
      { type: 'tool_use', toolId: 'call-1' },
      { type: 'text', content: 'Done.' },
    ]);
    expect(first(messages).toolCalls).toEqual([
      {
        id: 'call-1',
        name: 'obsidian_read',
        input: { path: 'A.md' },
        status: 'completed',
        isExpanded: false,
        result: 'contents',
      },
    ]);
    expect(first(messages).content).toBe('I will read it.\n\nDone.');
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
    expect(first(first(messages).toolCalls ?? [])).toMatchObject({
      id: 'call-1',
      status: 'completed',
      result: 'updated A.md',
      toolUseResult: details,
      diffData: {
        filePath: 'A.md',
        stats: { added: 1, removed: 1 },
      },
    });
    expect(first(first(messages).toolCalls ?? []).diffData?.diffLines).toEqual([
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
    expect(first(messages).contentBlocks).toEqual([{ type: 'tool_use', toolId: 'call-1' }]);
    expect(first(first(messages).toolCalls ?? [])).toMatchObject({
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
    expect(first(messages).content).toBe('Summary:\n\n- one\n- two');
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

  it('renders compaction entries as assistant context boundaries', () => {
    const branch: SessionEntry[] = [
      {
        type: 'message',
        id: 'a1',
        parentId: null,
        timestamp: '2026-01-01T00:00:00.000Z',
        message: { role: 'assistant', content: 'before' } as unknown as AgentMessage,
      },
      {
        type: 'compaction',
        id: 'compact-1',
        parentId: 'a1',
        timestamp: '2026-01-01T00:00:01.000Z',
        summary: 'Earlier context summary.',
        firstKeptEntryId: 'a1',
        tokensBefore: 1234,
      },
      {
        type: 'message',
        id: 'a2',
        parentId: 'compact-1',
        timestamp: '2026-01-01T00:00:02.000Z',
        message: { role: 'assistant', content: 'after' } as unknown as AgentMessage,
      },
    ];

    const messages = entriesToChatMessages(branch, new Map());

    expect(messages.map((message) => message.id)).toEqual(['a1', 'compact-1', 'a2']);
    expect(messages[1]).toMatchObject({
      role: 'assistant',
      content: '',
      contentBlocks: [{
        type: 'context_compacted',
        tokensAfter: expect.any(Number),
        tokensBefore: 1234,
      }],
      assistantMessageId: 'compact-1',
    });
    const compactionBlock = messages[1]?.contentBlocks?.[0];
    expect(compactionBlock?.type).toBe('context_compacted');
    const tokensAfter = compactionBlock?.type === 'context_compacted'
      ? compactionBlock.tokensAfter
      : undefined;
    const tokensBefore = compactionBlock?.type === 'context_compacted'
      ? compactionBlock.tokensBefore
      : undefined;
    expect(tokensAfter).toBeLessThan(tokensBefore ?? 0);
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

    expect(first(messages).contentBlocks).toEqual([{ type: 'text', content: 'from ui' }]);
  });

  it('restores persisted assistant tool-call overlays without duplicating merged content blocks', () => {
    const branch: SessionEntry[] = [
      {
        type: 'message',
        id: 'a1',
        parentId: null,
        timestamp: '2026-01-01T00:00:00.000Z',
        message: {
          role: 'assistant',
          content: [
            { type: 'text', text: 'First.' },
            { type: 'toolCall', id: 'spawn-1', name: 'spawn_agent', arguments: { label: 'Research' } },
          ],
          timestamp: 1,
        } as unknown as AgentMessage,
      },
      {
        type: 'message',
        id: 'a2',
        parentId: 'a1',
        timestamp: '2026-01-01T00:00:01.000Z',
        message: { role: 'assistant', content: [{ type: 'text', text: 'Second.' }], timestamp: 2 } as unknown as AgentMessage,
      },
      {
        type: 'custom',
        id: 'c1',
        parentId: 'a2',
        timestamp: '2026-01-01T00:00:02.000Z',
        customType: PIVI_MESSAGE_UI,
        data: {
          targetEntryId: 'a2',
          assistantMessageId: 'a2',
          contentBlocks: [
            { type: 'text', content: 'First.' },
            { type: 'subagent', subagentId: 'spawn-1', mode: 'async' },
            { type: 'text', content: 'Second.' },
          ],
          toolCalls: [{
            id: 'spawn-1',
            name: 'spawn_agent',
            input: { label: 'Research' },
            status: 'error',
            activityStatus: 'cancelled',
            isExpanded: false,
            subagent: {
              id: 'spawn-1',
              description: 'Research',
              mode: 'async',
              status: 'error',
              asyncStatus: 'error',
              activityStatus: 'cancelled',
              agentId: 'subagent-1',
              result: 'Done',
              toolCalls: [],
              isExpanded: false,
            },
          }],
        },
      },
    ];

    const messages = entriesToChatMessages(branch, collectMessageUiMap(branch));

    expect(messages).toHaveLength(1);
    expect(first(messages).content).toBe('First.\n\nSecond.');
    expect(first(messages).contentBlocks).toEqual([
      { type: 'text', content: 'First.' },
      { type: 'subagent', subagentId: 'spawn-1', mode: 'async' },
      { type: 'text', content: 'Second.' },
    ]);
    expect(first(first(messages).toolCalls ?? [])).toMatchObject({
      id: 'spawn-1',
      status: 'error',
      activityStatus: 'cancelled',
      subagent: {
        agentId: 'subagent-1',
        result: 'Done',
        asyncStatus: 'error',
        activityStatus: 'cancelled',
      },
    });
  });

  it('merges multiple message-ui patches for the same entry', () => {
    const branch: SessionEntry[] = [
      {
        type: 'custom',
        id: 'c1',
        parentId: null,
        timestamp: '2026-01-01T00:00:00.000Z',
        customType: PIVI_MESSAGE_UI,
        data: { targetEntryId: 'a1', contentBlocks: [{ type: 'text', content: 'hello' }] },
      },
      {
        type: 'custom',
        id: 'c2',
        parentId: 'c1',
        timestamp: '2026-01-01T00:00:01.000Z',
        customType: PIVI_MESSAGE_UI,
        data: { targetEntryId: 'a1', durationSeconds: 2 },
      },
    ];

    expect(collectMessageUiMap(branch).get('a1')).toEqual({
      targetEntryId: 'a1',
      contentBlocks: [{ type: 'text', content: 'hello' }],
      durationSeconds: 2,
    });
  });
});

describe('applySkillDescriptions', () => {
  const defuddleDir = '/vault/.pivi/skills/defuddle';
  const defuddleFilePath = `${defuddleDir}/SKILL.md`;
  const defuddleSkill: Skill = {
    name: 'defuddle',
    description: 'Extract clean article text from web pages.',
    filePath: defuddleFilePath,
    baseDir: defuddleDir,
    content: '# Defuddle instructions',
  };

  function assistantWithSkillToolCall(
    toolUseResult: Record<string, unknown>,
  ): ChatMessage[] {
    return [
      {
        id: 'msg-1',
        role: 'assistant',
        content: '',
        timestamp: 1,
        toolCalls: [
          {
            id: 'skill-call-1',
            name: TOOL_SKILL,
            input: { name: 'defuddle' },
            status: 'completed',
            result: '<skill name="defuddle"></skill>',
            toolUseResult,
          },
        ],
      },
    ];
  }

  it('fills missing description on restored skill tool results from current vault skills', () => {
    const messages = assistantWithSkillToolCall({
      baseDir: defuddleDir,
      filePath: defuddleFilePath,
    });

    const updated = applySkillDescriptions(messages, [defuddleSkill]);

    expect(first(first(updated).toolCalls ?? []).toolUseResult).toEqual({
      baseDir: defuddleDir,
      filePath: defuddleFilePath,
      description: 'Extract clean article text from web pages.',
    });
  });

  it('does not overwrite an existing persisted skill description', () => {
    const messages = assistantWithSkillToolCall({
      baseDir: defuddleDir,
      filePath: defuddleFilePath,
      description: 'Persisted preview text from session.',
    });

    const updated = applySkillDescriptions(messages, [
      { ...defuddleSkill, description: 'Current vault description.' },
    ]);

    expect(first(first(updated).toolCalls ?? []).toolUseResult?.description).toBe(
      'Persisted preview text from session.',
    );
  });

  it('matches skills by filePath when input name is absent on the tool call', () => {
    const messages: ChatMessage[] = [
      {
        id: 'msg-2',
        role: 'assistant',
        content: '',
        timestamp: 2,
        toolCalls: [
          {
            id: 'skill-call-2',
            name: TOOL_SKILL,
            input: {},
            status: 'completed',
            toolUseResult: { filePath: defuddleFilePath },
          },
        ],
      },
    ];

    applySkillDescriptions(messages, [defuddleSkill]);

    expect(first(first(messages).toolCalls ?? []).toolUseResult?.description).toBe(
      'Extract clean article text from web pages.',
    );
  });
});

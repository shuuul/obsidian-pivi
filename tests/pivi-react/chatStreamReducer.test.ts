import {
  createChatStreamSnapshot,
  reduceChatStreamSnapshot,
} from '@pivi/pivi-react/store';
import type { ChatMessage, StreamChunk } from '@pivi/pivi-agent-core/foundation';

function assistantMessage(): ChatMessage {
  return {
    id: 'assistant-1',
    role: 'assistant',
    content: '',
    timestamp: 1,
    toolCalls: [{
      id: 'agent-1',
      name: 'Agent',
      input: {},
      status: 'running',
      subagent: {
        id: 'subagent-1',
        description: 'Research',
        isExpanded: false,
        status: 'running',
        toolCalls: [],
      },
    }],
  };
}

describe('reduceChatStreamSnapshot', () => {
  it('reduces text, thinking, notice, error, and compaction chunks without mutating input', () => {
    const message = assistantMessage();
    let state = createChatStreamSnapshot(message);

    state = reduceChatStreamSnapshot(state, { type: 'text', content: 'Hello' });
    state = reduceChatStreamSnapshot(state, { type: 'thinking', content: 'Plan' });
    state = reduceChatStreamSnapshot(state, { type: 'notice', content: 'Policy', level: 'warning' });
    state = reduceChatStreamSnapshot(state, { type: 'error', content: 'Failed' });
    state = reduceChatStreamSnapshot(state, { type: 'context_compacted' });
    const compactedOnce = state;
    state = reduceChatStreamSnapshot(state, { type: 'context_compacted' });

    expect(message.content).toBe('');
    expect(state.message.content).toContain('Hello');
    expect(state.message.content).toContain('Blocked');
    expect(state.message.content).toContain('Failed');
    expect(state.message.contentBlocks).toEqual([
      { type: 'text', content: 'Hello' },
      { type: 'thinking', content: 'Plan' },
      { type: 'text', content: '\n\n⚠️ **Blocked:** Policy\n\n❌ **Error:** Failed' },
      { type: 'context_compacted' },
    ]);
    expect(state).toBe(compactedOnce);
  });

  it('preserves live checkpoint presentation on the compaction block', () => {
    const state = reduceChatStreamSnapshot(createChatStreamSnapshot(assistantMessage()), {
      type: 'context_compacted',
      summary: 'Compatibility summary',
      checkpoint: {
        artifacts: [],
        constraints: [],
        continuationSummary: 'Continue the live turn.',
        decisions: ['Keep the live path'],
        goal: null,
        nextSteps: ['Render it'],
        openWork: [],
        source: {
          firstEntryId: 'first',
          firstKeptEntryId: 'kept',
          lastEntryId: 'last',
        },
        tokenEstimate: 42,
        unresolvedQuestions: [],
      },
    });

    expect(state.message.contentBlocks).toEqual([expect.objectContaining({
      type: 'context_compacted',
      summary: 'Compatibility summary',
      checkpoint: expect.objectContaining({ continuationSummary: 'Continue the live turn.' }),
    })]);
  });

  it('merges repeated tool_use chunks and projects output and terminal results', () => {
    let state = createChatStreamSnapshot(assistantMessage());
    state = reduceChatStreamSnapshot(state, {
      type: 'tool_use', id: 'read-1', name: 'Read', input: {},
    });
    state = reduceChatStreamSnapshot(state, {
      type: 'tool_use', id: 'read-1', name: 'Read', input: { path: 'note.md' },
    });
    state = reduceChatStreamSnapshot(state, {
      type: 'tool_output', id: 'read-1', content: 'partial',
    });
    state = reduceChatStreamSnapshot(state, {
      type: 'tool_result', id: 'read-1', content: 'access denied',
    });

    const read = state.message.toolCalls?.find(toolCall => toolCall.id === 'read-1');
    expect(read).toMatchObject({
      input: { path: 'note.md' },
      result: 'access denied',
      status: 'completed',
    });
    expect(state.message.contentBlocks).toEqual([{ type: 'tool_use', toolId: 'read-1' }]);
  });

  it('uses structured blocked metadata instead of interpreting result text', () => {
    let state = createChatStreamSnapshot(assistantMessage());
    state = reduceChatStreamSnapshot(state, {
      type: 'tool_use', id: 'read-1', name: 'Read', input: {},
    });
    state = reduceChatStreamSnapshot(state, {
      type: 'tool_result',
      id: 'read-1',
      content: 'This documentation describes paths outside the vault.',
    });
    expect(state.message.toolCalls?.find(toolCall => toolCall.id === 'read-1')?.status).toBe('completed');

    state = reduceChatStreamSnapshot(state, {
      type: 'tool_result',
      id: 'read-1',
      content: 'The host rejected this operation.',
      isError: true,
      blocked: true,
    });
    expect(state.message.toolCalls?.find(toolCall => toolCall.id === 'read-1')?.status).toBe('blocked');
  });

  it('projects usage and all subagent chunk variants', () => {
    let state = createChatStreamSnapshot(assistantMessage());
    state = reduceChatStreamSnapshot(state, {
      type: 'usage',
      usage: { inputTokens: 1, contextWindow: 100, contextTokens: 1, percentage: 1 },
    });
    state = reduceChatStreamSnapshot(state, {
      type: 'subagent_text', subagentId: 'subagent-1', content: 'Working',
    });
    state = reduceChatStreamSnapshot(state, {
      type: 'subagent_tool_use', subagentId: 'subagent-1', id: 'nested-1', name: 'Read', input: {},
    });
    state = reduceChatStreamSnapshot(state, {
      type: 'subagent_tool_result', subagentId: 'subagent-1', id: 'nested-1', content: 'done',
    });
    state = reduceChatStreamSnapshot(state, {
      type: 'async_subagent_result', agentId: 'agent-id', subagentId: 'subagent-1', status: 'completed', result: 'Finished',
    });

    const subagent = state.message.toolCalls?.[0]?.subagent;
    expect(state.usage?.contextTokens).toBe(1);
    expect(subagent).toMatchObject({
      result: 'Finished',
      status: 'completed',
      asyncStatus: 'completed',
      toolCalls: [{ id: 'nested-1', status: 'completed', result: 'done' }],
    });
  });

  it.each<StreamChunk>([
    { type: 'user_message_start', content: 'User' },
    { type: 'assistant_message_start' },
    { type: 'done' },
    { type: 'context_compacting' },
    {
      type: 'retry_start',
      attempt: 1,
      maxAttempts: 3,
      delayMs: 2_000,
      errorMessage: 'socket hang up',
    },
    { type: 'retry_end', success: true, attempt: 1 },
  ])('leaves orchestration-only $type chunks outside reducer state', (chunk) => {
    const state = createChatStreamSnapshot(assistantMessage());
    expect(reduceChatStreamSnapshot(state, chunk)).toBe(state);
  });
});

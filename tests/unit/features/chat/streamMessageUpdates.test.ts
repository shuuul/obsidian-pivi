import type { ChatMessage } from '@pivi/pivi-agent-core/foundation';
import { hasPendingAsyncSubagent } from '@/ui/chat/rendering/messageRendererActions';
import {
  mergeStreamingToolUseInput,
  registerMessageToolCall,
  resolveRegularToolResultStatus,
} from '@/ui/chat/stream/StreamEventReducer';

describe('StreamEventReducer', () => {
  it('merges streaming input into an existing tool call', () => {
    const msg: ChatMessage = {
      id: 'm1',
      role: 'assistant',
      content: '',
      timestamp: 0,
      toolCalls: [{
        id: 'tc1',
        name: 'Read',
        input: { path: 'a.md' },
        status: 'running',
      }],
    };

    const result = mergeStreamingToolUseInput(msg, {
      id: 'tc1',
      name: 'Read',
      input: { offset: 10 },
    });

    expect(result.merged).toBe(true);
    expect(result.hadNewInputKeys).toBe(true);
    const mergedToolCall = msg.toolCalls?.[0];
    expect(mergedToolCall).toBeDefined();
    if (!mergedToolCall) throw new Error('Expected the merged tool call');
    expect(mergedToolCall.input).toEqual({ path: 'a.md', offset: 10 });
  });

  it('registers a new tool call with content block', () => {
    const msg: ChatMessage = {
      id: 'm1',
      role: 'assistant',
      content: '',
      timestamp: 0,
    };

    const toolCall = registerMessageToolCall(msg, {
      id: 'tc2',
      name: 'Write',
      input: { file_path: 'b.md' },
    }, { contentBlock: true });

    expect(toolCall.id).toBe('tc2');
    expect(msg.toolCalls).toHaveLength(1);
    expect(msg.contentBlocks).toEqual([{ type: 'tool_use', toolId: 'tc2' }]);
  });

  it('keeps repeated incremental tool use stable and preserves content block ordering', () => {
    const msg: ChatMessage = {
      id: 'm1',
      role: 'assistant',
      content: '',
      timestamp: 0,
      contentBlocks: [
        { type: 'text', content: 'Before tools.' },
        { type: 'thinking', content: 'Choose a file.' },
      ],
    };

    const applyToolUse = (chunk: {
      id: string;
      name: string;
      input: Record<string, unknown>;
    }): void => {
      const result = mergeStreamingToolUseInput(msg, chunk);
      if (!result.merged) {
        registerMessageToolCall(msg, chunk, { contentBlock: true });
      }
    };

    applyToolUse({ id: 'read-1', name: 'Read', input: {} });
    applyToolUse({ id: 'read-1', name: 'Read', input: { path: 'draft.md', offset: 10 } });
    applyToolUse({ id: 'read-1', name: 'Read', input: { path: 'final.md' } });

    expect(msg.toolCalls).toHaveLength(1);
    expect(msg.toolCalls?.[0]?.input).toEqual({ path: 'final.md', offset: 10 });
    expect(msg.contentBlocks).toEqual([
      { type: 'text', content: 'Before tools.' },
      { type: 'thinking', content: 'Choose a file.' },
      { type: 'tool_use', toolId: 'read-1' },
    ]);

    msg.contentBlocks?.push({ type: 'text', content: 'Between tools.' });
    applyToolUse({ id: 'write-2', name: 'Write', input: { path: 'final.md' } });
    msg.contentBlocks?.push({ type: 'thinking', content: 'Verify the result.' });

    expect(msg.toolCalls?.map(toolCall => toolCall.id)).toEqual(['read-1', 'write-2']);
    expect(msg.contentBlocks).toEqual([
      { type: 'text', content: 'Before tools.' },
      { type: 'thinking', content: 'Choose a file.' },
      { type: 'tool_use', toolId: 'read-1' },
      { type: 'text', content: 'Between tools.' },
      { type: 'tool_use', toolId: 'write-2' },
      { type: 'thinking', content: 'Verify the result.' },
    ]);
  });

  it('resolves blocked status from result text', () => {
    expect(resolveRegularToolResultStatus('Read', false, 'access denied')).toBe('blocked');
    expect(resolveRegularToolResultStatus('Read', true, 'fail')).toBe('error');
    expect(resolveRegularToolResultStatus('Read', false, 'ok')).toBe('completed');
  });
});

describe('message action gating', () => {
  it('treats pending or running async subagents as incomplete assistant messages', () => {
    const msg: ChatMessage = {
      id: 'm1',
      role: 'assistant',
      content: 'Waiting for background work',
      timestamp: 0,
      toolCalls: [{
        id: 'spawn-1',
        name: 'spawn_agent',
        input: { run_in_background: true },
        status: 'running',
        subagent: {
          id: 'spawn-1',
          mode: 'async',
          description: 'Read card',
          prompt: 'Read card',
          status: 'running',
          asyncStatus: 'running',
          toolCalls: [],
          isExpanded: false,
        },
      }],
    };

    expect(hasPendingAsyncSubagent(msg)).toBe(true);

    const toolCall = msg.toolCalls?.[0];
    expect(toolCall).toBeDefined();
    if (!toolCall) throw new Error('Expected the async subagent tool call');
    const subagent = toolCall.subagent;
    expect(subagent).toBeDefined();
    if (!subagent) throw new Error('Expected the async subagent metadata');
    toolCall.status = 'completed';
    subagent.status = 'completed';
    subagent.asyncStatus = 'completed';

    expect(hasPendingAsyncSubagent(msg)).toBe(false);
  });
});

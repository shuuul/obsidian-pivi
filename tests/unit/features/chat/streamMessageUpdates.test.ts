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
    expect(msg.toolCalls?.[0].input).toEqual({ path: 'a.md', offset: 10 });
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

    msg.toolCalls![0].status = 'completed';
    msg.toolCalls![0].subagent!.status = 'completed';
    msg.toolCalls![0].subagent!.asyncStatus = 'completed';

    expect(hasPendingAsyncSubagent(msg)).toBe(false);
  });
});

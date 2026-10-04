import type { ChatMessage } from '@pivi/agent/runtime';
import {
  formatConversationAsMarkdown,
  hasPendingAsyncSubagent,
} from '@/ui/chat/rendering/messageRendererActions';
import {
  resolveRegularToolResultStatus,
} from '@/ui/chat/stream/StreamEventReducer';

describe('StreamEventReducer', () => {
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

describe('conversation Markdown export', () => {
  it('copies formal user and agent text through the selected turn only', () => {
    const messages: ChatMessage[] = [
      { id: 'u1', role: 'user', content: 'First **question**', timestamp: 1 },
      {
        id: 'a1',
        role: 'assistant',
        content: 'hidden fallback',
        contentBlocks: [
          { type: 'thinking', content: 'private reasoning' },
          { type: 'tool_use', toolId: 'read-1' },
          { type: 'text', content: 'First answer\n\n```ts\nconst one = 1;\n```' },
        ],
        toolCalls: [{
          id: 'read-1',
          name: 'Read',
          input: { path: 'note.md' },
          result: 'private tool result',
          status: 'completed',
        }],
        timestamp: 2,
      },
      { id: 'u2', role: 'user', content: 'Second question', timestamp: 3 },
      { id: 'a2', role: 'assistant', content: 'Second answer', timestamp: 4 },
    ];

    expect(formatConversationAsMarkdown(messages, 'a1')).toBe([
      '## User',
      '',
      'First **question**',
      '',
      '## Agent',
      '',
      'First answer',
      '',
      '```ts',
      'const one = 1;',
      '```',
    ].join('\n'));
  });

  it('skips rebuilt context and empty process-only messages', () => {
    const messages: ChatMessage[] = [
      { id: 'rebuilt', role: 'user', content: 'internal context', isRebuiltContext: true, timestamp: 1 },
      { id: 'u1', role: 'user', content: 'Visible question', timestamp: 2 },
      {
        id: 'process',
        role: 'assistant',
        content: '',
        contentBlocks: [{ type: 'thinking', content: 'private reasoning' }],
        timestamp: 3,
      },
      { id: 'a1', role: 'assistant', content: 'Visible answer', timestamp: 4 },
    ];

    expect(formatConversationAsMarkdown(messages, 'a1')).toBe(
      '## User\n\nVisible question\n\n## Agent\n\nVisible answer',
    );
  });
});

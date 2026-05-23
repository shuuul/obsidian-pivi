import { PiAgentEventAdapter } from '../../../../src/providers/pi/runtime/PiAgentEventAdapter';

describe('PiAgentEventAdapter', () => {
  const adapter = new PiAgentEventAdapter();

  describe('turn_start', () => {
    it('produces assistant_message_start', () => {
      const chunks = adapter.adapt({ type: 'turn_start' });
      expect(chunks).toEqual([{ type: 'assistant_message_start' }]);
    });
  });

  describe('agent_end', () => {
    it('produces done', () => {
      const chunks = adapter.adapt({ type: 'agent_end', messages: [] });
      expect(chunks).toEqual([{ type: 'done' }]);
    });
  });

  describe('message_end', () => {
    it('produces error chunk when assistant message has errorMessage', () => {
      const chunks = adapter.adapt({
        type: 'message_end',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: '' }],
          errorMessage: 'API key is invalid',
          stopReason: 'error',
          usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
          api: 'anthropic-messages',
          provider: 'anthropic',
          model: 'claude-3-5-sonnet',
          timestamp: Date.now(),
        } as any,
      });
      expect(chunks).toEqual([{ type: 'error', content: 'API key is invalid' }]);
    });

    it('produces empty array when assistant message has no errorMessage', () => {
      const chunks = adapter.adapt({
        type: 'message_end',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'Hello' }],
          stopReason: 'stop',
          usage: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, totalTokens: 15, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
          api: 'anthropic-messages',
          provider: 'anthropic',
          model: 'claude-3-5-sonnet',
          timestamp: Date.now(),
        } as any,
      });
      expect(chunks).toEqual([]);
    });

    it('produces empty array for non-assistant message_end', () => {
      const chunks = adapter.adapt({
        type: 'message_end',
        message: {
          role: 'user',
          content: 'hi',
          timestamp: Date.now(),
        } as any,
      });
      expect(chunks).toEqual([]);
    });

    it('produces empty array when errorMessage is empty string', () => {
      const chunks = adapter.adapt({
        type: 'message_end',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: '' }],
          errorMessage: '',
          stopReason: 'stop',
          usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
          api: 'anthropic-messages',
          provider: 'anthropic',
          model: 'claude-3-5-sonnet',
          timestamp: Date.now(),
        } as any,
      });
      expect(chunks).toEqual([]);
    });
  });

  describe('message_update', () => {
    it('produces text chunk for text_delta', () => {
      const chunks = adapter.adapt({
        type: 'message_update',
        message: {} as any,
        assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: 'Hello', partial: {} as any },
      });
      expect(chunks).toEqual([{ type: 'text', content: 'Hello' }]);
    });

    it('produces thinking chunk for thinking_delta', () => {
      const chunks = adapter.adapt({
        type: 'message_update',
        message: {} as any,
        assistantMessageEvent: { type: 'thinking_delta', contentIndex: 0, delta: 'Hmm', partial: {} as any },
      });
      expect(chunks).toEqual([{ type: 'thinking', content: 'Hmm' }]);
    });

    it('produces error chunk for error assistantMessageEvent', () => {
      const chunks = adapter.adapt({
        type: 'message_update',
        message: {} as any,
        assistantMessageEvent: {
          type: 'error',
          reason: 'error',
          error: {
            role: 'assistant',
            errorMessage: 'Rate limit exceeded',
            content: [],
            stopReason: 'error',
          } as any,
        },
      });
      expect(chunks).toEqual([{ type: 'error', content: 'Rate limit exceeded' }]);
    });

    it('produces fallback error chunk when error event has no message', () => {
      const chunks = adapter.adapt({
        type: 'message_update',
        message: {} as any,
        assistantMessageEvent: {
          type: 'error',
          reason: 'error',
          error: {} as any,
        },
      });
      expect(chunks).toEqual([{ type: 'error', content: 'An unknown error occurred' }]);
    });
  });

  describe('tool events', () => {
    it('produces tool_use for tool_execution_start', () => {
      const chunks = adapter.adapt({
        type: 'tool_execution_start',
        toolCallId: 'call-1',
        toolName: 'Read',
        args: { file_path: '/test.md' },
      });
      expect(chunks).toEqual([{
        type: 'tool_use',
        id: 'call-1',
        name: 'Read',
        input: { file_path: '/test.md' },
      }]);
    });

    it('produces tool_result for tool_execution_end', () => {
      const chunks = adapter.adapt({
        type: 'tool_execution_end',
        toolCallId: 'call-1',
        toolName: 'Read',
        result: {
          content: [{ type: 'text', text: 'file contents' }],
        },
        isError: false,
      });
      expect(chunks).toEqual([{
        type: 'tool_result',
        id: 'call-1',
        content: 'file contents',
        isError: false,
      }]);
    });
  });

  describe('unmapped events', () => {
    it('returns empty for agent_start', () => {
      expect(adapter.adapt({ type: 'agent_start' })).toEqual([]);
    });

    it('returns empty for message_start', () => {
      expect(adapter.adapt({
        type: 'message_start',
        message: { role: 'user', content: 'hi', timestamp: 0 } as any,
      })).toEqual([]);
    });

    it('returns empty for turn_end', () => {
      expect(adapter.adapt({
        type: 'turn_end',
        message: {} as any,
        toolResults: [],
      })).toEqual([]);
    });
  });
});

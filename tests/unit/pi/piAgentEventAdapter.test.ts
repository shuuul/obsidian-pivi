import { PiAgentEventAdapter } from '@pivi/pivi-agent-core/engine/pi/piAgentEventAdapter';

describe('PiAgentEventAdapter', () => {
  const adapter = new PiAgentEventAdapter();

  describe('turn_start', () => {
    it('does not create a visible assistant boundary', () => {
      const chunks = adapter.adapt({ type: 'turn_start' });
      expect(chunks).toEqual([]);
    });
  });

  describe('message_start', () => {
    it('produces user_message_start for user messages', () => {
      expect(adapter.adapt({
        type: 'message_start',
        message: { role: 'user', content: 'hi', timestamp: 0 } as any,
      })).toEqual([{ type: 'user_message_start', content: 'hi' }]);
    });

    it('produces assistant_message_start for assistant messages', () => {
      expect(adapter.adapt({
        type: 'message_start',
        message: { role: 'assistant', content: [], timestamp: 0 } as any,
      })).toEqual([{ type: 'assistant_message_start' }]);
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

    it('enhances generic connection errors with provider and network guidance', () => {
      const chunks = adapter.adapt({
        type: 'message_end',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: '' }],
          errorMessage: 'Connection error.',
          stopReason: 'error',
          usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
          api: 'openai-completions',
          provider: 'opencode-go',
          model: 'deepseek-v4-flash',
          timestamp: Date.now(),
        } as any,
      });
      expect(chunks).toHaveLength(1);
      expect(chunks[0]).toMatchObject({ type: 'error' });
      const content = (chunks[0] as { content: string }).content;
      expect(content).toContain('Connection error.');
      expect(content).toContain('Provider: opencode-go, Model: deepseek-v4-flash.');
      expect(content).toContain('Check that the API endpoint is reachable');
      expect(content).toContain('OPENCODE_API_KEY');
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

    it('enriches context overflow errors with model, window, usage, and guidance', () => {
      const diagnosing = new PiAgentEventAdapter(() => ({
        model: 'openai-codex/gpt-5.3-codex-spark',
        contextWindow: 128_000,
        contextTokens: 126_816,
      }));
      const chunks = diagnosing.adapt({
        type: 'message_end',
        message: {
          role: 'assistant',
          content: [],
          errorMessage: 'Codex error: Your input exceeds the context window of this model. Please adjust your input and try again.',
          stopReason: 'error',
          usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
          api: 'openai-codex-responses',
          provider: 'openai-codex',
          model: 'gpt-5.3-codex-spark',
          timestamp: Date.now(),
        } as any,
      });
      expect(chunks).toHaveLength(1);
      const overflowChunk = chunks[0];
      if (overflowChunk?.type !== 'error') {
        throw new Error('expected an error chunk');
      }
      const content = overflowChunk.content;
      expect(content).toContain('exceeds the context window');
      expect(content).toContain('Model: openai-codex/gpt-5.3-codex-spark.');
      expect(content).toContain('Context window: 128K tokens.');
      expect(content).toContain('Current context usage: ~126.8K tokens.');
      expect(content).toContain('/compact');
    });

    it('falls back to the message model when no error context resolver is set', () => {
      const chunks = adapter.adapt({
        type: 'message_end',
        message: {
          role: 'assistant',
          content: [],
          errorMessage: 'prompt is too long: 213462 tokens > 200000 maximum',
          stopReason: 'error',
          usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
          api: 'anthropic-messages',
          provider: 'anthropic',
          model: 'claude-3-5-sonnet',
          timestamp: Date.now(),
        } as any,
      });
      const fallbackChunk = chunks[0];
      if (fallbackChunk?.type !== 'error') {
        throw new Error('expected an error chunk');
      }
      const content = fallbackChunk.content;
      expect(content).toContain('prompt is too long');
      expect(content).toContain('Model: anthropic/claude-3-5-sonnet.');
      expect(content).not.toContain('Context window:');
    });

    it('leaves non-overflow errors untouched when a resolver is set', () => {
      const diagnosing = new PiAgentEventAdapter(() => ({
        model: 'openai-codex/gpt-5.3-codex-spark',
        contextWindow: 128_000,
      }));
      const chunks = diagnosing.adapt({
        type: 'message_end',
        message: {
          role: 'assistant',
          content: [],
          errorMessage: 'API key is invalid',
          stopReason: 'error',
          usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
          api: 'openai-codex-responses',
          provider: 'openai-codex',
          model: 'gpt-5.3-codex-spark',
          timestamp: Date.now(),
        } as any,
      });
      expect(chunks).toEqual([{ type: 'error', content: 'API key is invalid' }]);
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

    it('preserves structured tool result details from tool_execution_end', () => {
      const toolUseResult = {
        type: 'diff',
        filePath: 'note.md',
        oldText: 'old',
        newText: 'new',
      };
      const chunks = adapter.adapt({
        type: 'tool_execution_end',
        toolCallId: 'call-2',
        toolName: 'Edit',
        result: {
          content: [{ type: 'text', text: 'edited note.md' }],
          details: toolUseResult,
        },
        isError: false,
      });
      expect(chunks).toEqual([{
        type: 'tool_result',
        id: 'call-2',
        content: 'edited note.md',
        isError: false,
        toolUseResult,
      }]);
    });

    it('projects structured blocked metadata from tool result details', () => {
      const chunks = adapter.adapt({
        type: 'tool_execution_end',
        toolCallId: 'call-blocked',
        toolName: 'Read',
        result: {
          content: [{ type: 'text', text: 'The host rejected this operation.' }],
          details: { blocked: true, errorCode: 'path_outside_scope' },
        },
        isError: true,
      });
      expect(chunks).toEqual([{
        type: 'tool_result',
        id: 'call-blocked',
        content: 'The host rejected this operation.',
        isError: true,
        blocked: true,
        toolUseResult: { blocked: true, errorCode: 'path_outside_scope' },
      }]);
    });

    it('falls back to a failure message for errored tool_execution_end without text content', () => {
      const chunks = adapter.adapt({
        type: 'tool_execution_end',
        toolCallId: 'call-3',
        toolName: 'Read',
        result: { content: [] },
        isError: true,
      });
      expect(chunks).toEqual([{
        type: 'tool_result',
        id: 'call-3',
        content: 'Tool failed',
        isError: true,
      }]);
    });
  });

  describe('unmapped events', () => {
    it('returns empty for agent_start', () => {
      expect(adapter.adapt({ type: 'agent_start' })).toEqual([]);
    });

    it('returns empty for non-visible message_start roles', () => {
      expect(adapter.adapt({
        type: 'message_start',
        message: { role: 'toolResult', toolCallId: 'call-1', content: [], timestamp: 0 } as any,
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

import type { ChatMessage } from '@pivi/pivi-agent-core/foundation';
import { InputProviderBoundaryHandler } from '@/ui/chat/controllers/inputProviderBoundaries';
import {
  getProviderBoundaryChunkType,
  shouldDiscardPendingAssistantPlaceholder,
  shouldIgnoreAssistantContinuationBoundary,
} from '@/ui/chat/controllers/inputProviderBoundary';

describe('inputProviderBoundary', () => {
  it('detects provider boundary chunks', () => {
    expect(getProviderBoundaryChunkType({ type: 'user_message_start', content: 'hi' }))
      .toBe('user_message_start');
    expect(getProviderBoundaryChunkType({ type: 'text', content: 'x' })).toBeNull();
  });

  it('discards empty assistant placeholder while awaiting provider start', () => {
    const message: ChatMessage = {
      id: 'a1',
      role: 'assistant',
      content: '',
      timestamp: 0,
      toolCalls: [],
      contentBlocks: [],
    };
    expect(shouldDiscardPendingAssistantPlaceholder(true, message)).toBe(true);
    expect(shouldDiscardPendingAssistantPlaceholder(false, message)).toBe(false);
  });

  it('ignores assistant continuation markers without a provider user boundary', () => {
    const message: ChatMessage = {
      id: 'a1',
      role: 'assistant',
      content: '',
      timestamp: 0,
      toolCalls: [{ id: 'tool-1', name: 'List', input: {}, status: 'completed' }],
      contentBlocks: [{ type: 'tool_use', toolId: 'tool-1' }],
    };

    expect(shouldIgnoreAssistantContinuationBoundary(false, message)).toBe(true);
    expect(shouldIgnoreAssistantContinuationBoundary(true, message)).toBe(false);
    expect(shouldIgnoreAssistantContinuationBoundary(false, null)).toBe(false);
  });

  it('replaces a failed partial assistant before a provider retry', () => {
    const failed: ChatMessage = {
      id: 'failed',
      role: 'assistant',
      content: 'Partial answer',
      timestamp: 0,
      toolCalls: [],
      contentBlocks: [{ type: 'text', content: 'Partial answer' }],
    };
    const messages = [failed];
    let active: ChatMessage | null = failed;
    const handler = new InputProviderBoundaryHandler({
      deps: {
        generateId: () => 'retry',
        state: {
          addMessage: (message: ChatMessage) => messages.push(message),
        },
      } as never,
      getActiveStreamingAssistantMessage: () => active,
      setActiveStreamingAssistantMessage: message => {
        active = message;
      },
      discardStreamingAssistantMessage: messageId => {
        const index = messages.findIndex(message => message.id === messageId);
        if (index >= 0) messages.splice(index, 1);
      },
      updateQueueIndicator: jest.fn(),
    });

    expect(handler.handleProviderMessageBoundaryChunk({
      type: 'retry_start',
      attempt: 1,
      maxAttempts: 3,
      delayMs: 2_000,
      errorMessage: 'socket hang up',
    })).toBe(false);

    expect(messages).toEqual([
      expect.objectContaining({ id: 'retry', role: 'assistant', content: '' }),
    ]);
    expect(active).toEqual(expect.objectContaining({ id: 'retry' }));
    expect(handler.handleProviderMessageBoundaryChunk({ type: 'assistant_message_start' }))
      .toBe(true);
    expect(messages).toHaveLength(1);
  });
});

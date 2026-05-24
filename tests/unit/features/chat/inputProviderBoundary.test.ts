import type { ChatMessage } from '../../../../src/core/types';
import {
  getProviderBoundaryChunkType,
  shouldDiscardPendingAssistantPlaceholder,
} from '../../../../src/features/chat/controllers/inputProviderBoundary';

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
});

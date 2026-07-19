import { toQueuedChatTurn } from '@/ui/chat/composer/ComposerQueue';
import type { QueuedMessage } from '@/ui/chat/state/types';

describe('inputQueue', () => {
  it('preserves a queued turn snapshot', () => {
    const message: QueuedMessage = {
      id: 'queued-1',
      content: 'first',
      editorContext: null,
      canvasContext: null,
      turnRequest: { text: 'first' },
    };

    expect(toQueuedChatTurn(message).request.text).toBe('first');
  });
});

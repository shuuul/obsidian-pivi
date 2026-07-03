import {
  formatQueuedMessagePreview,
  mergeQueuedMessages,
  toQueuedChatTurn,
} from '@/ui/chat/composer/ComposerQueue';
import type { QueuedMessage } from '@/ui/chat/state/types';

describe('inputQueue', () => {
  it('formats preview with image hint', () => {
    const message: QueuedMessage = {
      content: 'hello',
      editorContext: null,
      canvasContext: null,
      images: [{
        id: 'img-1',
        name: 'x.png',
        mediaType: 'image/png',
        data: 'abc',
        size: 3,
        source: 'paste',
      }],
    };
    expect(formatQueuedMessagePreview(message)).toBe('hello [images]');
  });

  it('merges queued turns into one message', () => {
    const first: QueuedMessage = {
      content: 'first',
      editorContext: null,
      canvasContext: null,
      turnRequest: { text: 'first' },
    };
    const second: QueuedMessage = {
      content: 'second',
      editorContext: null,
      canvasContext: null,
      turnRequest: { text: 'second' },
    };

    const merged = mergeQueuedMessages(first, second);
    expect(merged.content).toBe('first\n\nsecond');
    expect(toQueuedChatTurn(merged).request.text).toBe('first\n\nsecond');
  });
});

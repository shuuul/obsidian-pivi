import type { ChatMessage } from '@pivi/pivi-agent-core/foundation';
import { captureResponseDurationFooter } from '@/ui/chat/composer/ComposerResponseDuration';


function createAssistantMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: 'assistant-1',
    role: 'assistant',
    content: '',
    timestamp: 1,
    contentBlocks: [],
    ...overrides,
  };
}

describe('captureResponseDurationFooter', () => {
  it('stores duration metadata on the message', () => {
    const message = createAssistantMessage();

    captureResponseDurationFooter({
      message,
      responseStartTime: 1_000,
      didCancelThisTurn: false,
      now: () => 124_000,
      pickFlavorWord: () => 'Baked',
    });

    expect(message.durationSeconds).toBe(123);
    expect(message.durationFlavorWord).toBe('Baked');
  });

  it('skips cancelled, compacted, and sub-second turns', () => {
    const cases: Array<Parameters<typeof captureResponseDurationFooter>[0]> = [
      {
        message: createAssistantMessage(),
        responseStartTime: 1_000,
        didCancelThisTurn: true,
        now: () => 3_000,
      },
      {
        message: createAssistantMessage({ contentBlocks: [{ type: 'context_compacted' }] }),
        responseStartTime: 1_000,
        didCancelThisTurn: false,
        now: () => 3_000,
      },
      {
        message: createAssistantMessage(),
        responseStartTime: 1_000,
        didCancelThisTurn: false,
        now: () => 1_500,
      },
    ];

    for (const options of cases) {
      captureResponseDurationFooter(options);

      expect(options.message.durationSeconds).toBeUndefined();
    }
  });
});

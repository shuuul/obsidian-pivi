import type { ChatMessage } from '@pivi/agent/runtime';
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
    expect(message.tokensPerSecond).toBeUndefined();
  });

  it('persists rounded tokens/s from output tokens and generation elapsed', () => {
    const message = createAssistantMessage();

    captureResponseDurationFooter({
      message,
      responseStartTime: 1_000,
      didCancelThisTurn: false,
      outputTokens: 80,
      generationElapsedMs: 2_000,
      now: () => 1_500,
    });

    expect(message.durationSeconds).toBeUndefined();
    expect(message.tokensPerSecond).toBe(40);
  });

  it('excludes paused tool time from tokens/s', () => {
    const message = createAssistantMessage();

    captureResponseDurationFooter({
      message,
      responseStartTime: 1_000,
      didCancelThisTurn: false,
      outputTokens: 90,
      generationElapsedMs: 1_500,
      now: () => 6_000,
    });

    expect(message.durationSeconds).toBe(5);
    expect(message.tokensPerSecond).toBe(60);
  });

  it('skips tokens/s for cancelled or compacted turns', () => {
    const cancelled = createAssistantMessage();
    captureResponseDurationFooter({
      message: cancelled,
      responseStartTime: 1_000,
      didCancelThisTurn: true,
      outputTokens: 80,
      generationElapsedMs: 2_000,
      now: () => 3_000,
    });
    expect(cancelled.tokensPerSecond).toBeUndefined();

    const compacted = createAssistantMessage({ contentBlocks: [{ type: 'context_compacted' }] });
    captureResponseDurationFooter({
      message: compacted,
      responseStartTime: 1_000,
      didCancelThisTurn: false,
      outputTokens: 80,
      generationElapsedMs: 2_000,
      now: () => 3_000,
    });
    expect(compacted.tokensPerSecond).toBeUndefined();
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

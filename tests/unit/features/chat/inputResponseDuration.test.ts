import type { ChatMessage } from '../../../../src/core/types';
import { captureResponseDurationFooter } from '../../../../src/features/chat/controllers/inputResponseDuration';

class FakeElement {
  children: Array<{ cls?: string; text?: string; element: FakeElement }> = [];

  createDiv(options: { cls?: string; text?: string } = {}): FakeElement {
    const element = new FakeElement();
    this.children.push({ ...options, element });
    return element;
  }

  createSpan(options: { cls?: string; text?: string } = {}): FakeElement {
    const element = new FakeElement();
    this.children.push({ ...options, element });
    return element;
  }
}

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
  it('stores duration metadata and renders the live footer', () => {
    const message = createAssistantMessage();
    const contentEl = new FakeElement();

    captureResponseDurationFooter({
      message,
      responseStartTime: 1_000,
      currentContentEl: contentEl as never,
      didCancelThisTurn: false,
      now: () => 124_000,
      pickFlavorWord: () => 'Baked',
    });

    expect(message.durationSeconds).toBe(123);
    expect(message.durationFlavorWord).toBe('Baked');
    expect(contentEl.children[0]).toMatchObject({ cls: 'obsius2-response-footer' });
    expect(contentEl.children[0]?.element.children[0]).toMatchObject({
      cls: 'obsius2-baked-duration',
      text: '* Baked for 2m 3s',
    });
  });

  it('skips cancelled, compacted, and sub-second turns', () => {
    const cases: Array<Parameters<typeof captureResponseDurationFooter>[0]> = [
      {
        message: createAssistantMessage(),
        responseStartTime: 1_000,
        currentContentEl: new FakeElement() as never,
        didCancelThisTurn: true,
        now: () => 3_000,
      },
      {
        message: createAssistantMessage({ contentBlocks: [{ type: 'context_compacted' }] }),
        responseStartTime: 1_000,
        currentContentEl: new FakeElement() as never,
        didCancelThisTurn: false,
        now: () => 3_000,
      },
      {
        message: createAssistantMessage(),
        responseStartTime: 1_000,
        currentContentEl: new FakeElement() as never,
        didCancelThisTurn: false,
        now: () => 1_500,
      },
    ];

    for (const options of cases) {
      captureResponseDurationFooter(options);

      expect(options.message.durationSeconds).toBeUndefined();
      expect((options.currentContentEl as unknown as FakeElement).children).toHaveLength(0);
    }
  });
});

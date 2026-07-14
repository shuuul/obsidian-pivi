import { MessageRenderer } from '@/ui/chat/rendering/MessageRenderer';

describe('MessageRenderer', () => {
  it('schedules near-bottom scrolling in the messages element owner window', () => {
    const ownerRequestAnimationFrame = jest.fn((callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    const globalRequestAnimationFrame = jest.fn();
    const messagesEl = {
      ownerDocument: {
        defaultView: { requestAnimationFrame: ownerRequestAnimationFrame },
      },
      scrollTop: 850,
      scrollHeight: 1000,
      clientHeight: 100,
    } as unknown as HTMLElement;
    const renderer = Object.assign(Object.create(MessageRenderer.prototype), { messagesEl }) as MessageRenderer;
    const originalRequestAnimationFrame = window.requestAnimationFrame;
    window.requestAnimationFrame = globalRequestAnimationFrame;

    try {
      renderer.scrollToBottomIfNeeded();
    } finally {
      window.requestAnimationFrame = originalRequestAnimationFrame;
    }

    expect(ownerRequestAnimationFrame).toHaveBeenCalledTimes(1);
    expect(globalRequestAnimationFrame).not.toHaveBeenCalled();
    expect(messagesEl.scrollTop).toBe(1000);
  });

  it('does not schedule scrolling when the messages element is away from the bottom', () => {
    const requestAnimationFrame = jest.fn();
    const messagesEl = {
      ownerDocument: { defaultView: { requestAnimationFrame } },
      scrollTop: 100,
      scrollHeight: 1000,
      clientHeight: 100,
    } as unknown as HTMLElement;
    const renderer = Object.assign(Object.create(MessageRenderer.prototype), { messagesEl }) as MessageRenderer;

    renderer.scrollToBottomIfNeeded();

    expect(requestAnimationFrame).not.toHaveBeenCalled();
  });
});

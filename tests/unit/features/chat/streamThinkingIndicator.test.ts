import { ChatState } from '@/ui/chat/state/ChatState';
import {
  hideThinkingIndicator,
  showThinkingIndicator,
  THINKING_INDICATOR_DELAY_MS,
} from '@/ui/chat/stream/streamThinkingIndicator';

describe('streamThinkingIndicator', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  function createDeps(state: ChatState = new ChatState()) {
    const ownerWindow = {
      setTimeout: (handler: TimerHandler, timeout?: number) => global.setTimeout(handler, timeout) as unknown as number,
      clearTimeout: (id: number | null) => {
        if (id !== null) global.clearTimeout(id);
      },
      setInterval: (handler: TimerHandler, timeout?: number) => global.setInterval(handler, timeout) as unknown as number,
      clearInterval: (id: number | null) => {
        if (id !== null) global.clearInterval(id);
      },
    } as unknown as Window;

    const messagesEl = {
      ownerDocument: {
        defaultView: ownerWindow,
      },
    } as unknown as HTMLElement;

    return {
      state,
      deps: {
        state,
        updateQueueIndicator: jest.fn(),
        getMessagesEl: () => messagesEl,
      },
    };
  }

  it('writes an immutable thinkingIndicator after the delay and ticks elapsed labels', () => {
    const { state, deps } = createDeps();
    state.isStreaming = true;
    state.responseStartTime = performance.now() - 1500;

    showThinkingIndicator(deps, 'Custom thinking', 'pivi-thinking--compact');
    expect(state.uiStore.getSnapshot().thinkingIndicator).toBeNull();

    jest.advanceTimersByTime(THINKING_INDICATOR_DELAY_MS);
    const first = state.uiStore.getSnapshot().thinkingIndicator;
    expect(first).toEqual({
      text: 'Custom thinking',
      className: 'pivi-thinking pivi-thinking--compact',
      elapsedLabel: expect.stringContaining('esc to interrupt'),
    });
    expect(Object.isFrozen(first)).toBe(true);

    jest.advanceTimersByTime(1000);
    const second = state.uiStore.getSnapshot().thinkingIndicator;
    expect(second?.text).toBe('Custom thinking');
    expect(second?.elapsedLabel).not.toEqual(first?.elapsedLabel);

    hideThinkingIndicator(deps);
    expect(state.uiStore.getSnapshot().thinkingIndicator).toBeNull();
  });

  it('suppresses the indicator when real thinking content is present', () => {
    const { state, deps } = createDeps();
    state.isStreaming = true;
    state.uiStore.update({ currentThinkingContent: 'real thinking' });

    showThinkingIndicator(deps, 'Should not show');
    jest.advanceTimersByTime(THINKING_INDICATOR_DELAY_MS);
    expect(state.uiStore.getSnapshot().thinkingIndicator).toBeNull();
  });

  it('does not resurrect a cancelled indicator after hide', () => {
    const { state, deps } = createDeps();
    state.isStreaming = true;

    showThinkingIndicator(deps, 'Pending');
    hideThinkingIndicator(deps);
    jest.advanceTimersByTime(THINKING_INDICATOR_DELAY_MS);
    expect(state.uiStore.getSnapshot().thinkingIndicator).toBeNull();
  });

  it('keeps an already-visible indicator idempotent across repeated show calls', () => {
    const { state, deps } = createDeps();
    state.isStreaming = true;

    showThinkingIndicator(deps, 'First');
    jest.advanceTimersByTime(THINKING_INDICATOR_DELAY_MS);
    const first = state.uiStore.getSnapshot().thinkingIndicator;

    showThinkingIndicator(deps, 'Second');
    jest.advanceTimersByTime(THINKING_INDICATOR_DELAY_MS);
    expect(state.uiStore.getSnapshot().thinkingIndicator).toEqual(first);
  });
});

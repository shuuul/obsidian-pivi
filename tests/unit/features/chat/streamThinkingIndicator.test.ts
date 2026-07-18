import { ChatState } from '@/ui/chat/state/ChatState';
import {
  hideThinkingIndicator,
  hideRetryIndicator,
  showThinkingIndicator,
  showRetryIndicator,
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

  it('writes an immutable thinkingIndicator immediately and ticks elapsed labels', () => {
    const { state, deps } = createDeps();
    state.isStreaming = true;
    state.responseStartTime = performance.now() - 1500;

    showThinkingIndicator(deps, 'Custom thinking');
    const first = state.uiStore.getSnapshot().thinkingIndicator;
    expect(first).toEqual({
      text: 'Custom thinking',
      className: 'pivi-thinking',
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

  it('keeps the indicator visible while real thinking content is present', () => {
    const { state, deps } = createDeps();
    state.isStreaming = true;
    state.uiStore.update({ currentThinkingContent: 'real thinking' });

    showThinkingIndicator(deps, 'Still visible');
    expect(state.uiStore.getSnapshot().thinkingIndicator).toEqual({
      text: 'Still visible',
      className: 'pivi-thinking',
      elapsedLabel: '',
    });
  });

  it('clears the indicator and cancels elapsed ticks on hide', () => {
    const { state, deps } = createDeps();
    state.isStreaming = true;

    showThinkingIndicator(deps, 'Visible');
    hideThinkingIndicator(deps);
    jest.advanceTimersByTime(2000);
    expect(state.uiStore.getSnapshot().thinkingIndicator).toBeNull();
  });

  it('keeps an already-visible indicator idempotent across repeated show calls', () => {
    const { state, deps } = createDeps();
    state.isStreaming = true;

    showThinkingIndicator(deps, 'First');
    const first = state.uiStore.getSnapshot().thinkingIndicator;

    showThinkingIndicator(deps, 'Second');
    expect(state.uiStore.getSnapshot().thinkingIndicator).toEqual(first);
  });

  it('projects retry countdowns onto the indicator and restores its prior text', () => {
    const { state, deps } = createDeps();
    state.isStreaming = true;
    state.responseStartTime = performance.now() - 1500;

    showThinkingIndicator(deps, 'Distilling...');
    showRetryIndicator(deps, { attempt: 1, maxAttempts: 3, delayMs: 2000 });

    expect(state.uiStore.getSnapshot().thinkingIndicator).toEqual({
      text: 'Connection interrupted · Retrying 1/3 in 2s',
      className: 'pivi-thinking',
      elapsedLabel: expect.stringContaining('esc to interrupt'),
    });

    jest.advanceTimersByTime(1000);
    expect(state.uiStore.getSnapshot().thinkingIndicator?.text)
      .toBe('Connection interrupted · Retrying 1/3 in 1s');

    jest.advanceTimersByTime(1000);
    expect(state.uiStore.getSnapshot().thinkingIndicator?.text)
      .toBe('Connection interrupted · Retrying 1/3…');

    hideRetryIndicator(deps, 1);
    expect(state.uiStore.getSnapshot().thinkingIndicator).toEqual({
      text: 'Distilling...',
      className: 'pivi-thinking',
      elapsedLabel: expect.stringContaining('esc to interrupt'),
    });
  });

  it('ignores stale retry_end events', () => {
    const { state, deps } = createDeps();
    state.isStreaming = true;

    showThinkingIndicator(deps, 'Distilling...');
    showRetryIndicator(deps, { attempt: 2, maxAttempts: 3, delayMs: 4000 });
    hideRetryIndicator(deps, 1);

    expect(state.uiStore.getSnapshot().thinkingIndicator?.text)
      .toBe('Connection interrupted · Retrying 2/3 in 4s');
  });
});

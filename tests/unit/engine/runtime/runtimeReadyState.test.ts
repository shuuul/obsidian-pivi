import { RuntimeReadyState } from '@pivi/pivi-agent-core/runtime/runtimeReadyState';

describe('RuntimeReadyState', () => {
  it('starts not ready', () => {
    const state = new RuntimeReadyState();

    expect(state.isReady()).toBe(false);
  });

  it('notifies listeners on false to true transition', () => {
    const state = new RuntimeReadyState();
    const listener = jest.fn();
    state.onReadyStateChange(listener);

    state.setReady(true);

    expect(state.isReady()).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(true);
  });

  it('notifies listeners on true to false transition', () => {
    const state = new RuntimeReadyState();
    const listener = jest.fn();
    state.onReadyStateChange(listener);
    state.setReady(true);
    listener.mockClear();

    state.setReady(false);

    expect(state.isReady()).toBe(false);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(false);
  });

  it.each([
    { name: 'already true', initial: true, next: true },
    { name: 'already false', initial: false, next: false },
  ])('does not notify when setting the same ready state ($name)', ({ initial, next }) => {
    const state = new RuntimeReadyState();
    const listener = jest.fn();
    state.onReadyStateChange(listener);
    if (initial) {
      state.setReady(true);
    }
    listener.mockClear();

    state.setReady(next);

    expect(state.isReady()).toBe(next);
    expect(listener).not.toHaveBeenCalled();
  });

  it('stops notifying after unsubscribe', () => {
    const state = new RuntimeReadyState();
    const listener = jest.fn();
    const unsubscribe = state.onReadyStateChange(listener);

    unsubscribe();
    state.setReady(true);
    state.setReady(false);

    expect(listener).not.toHaveBeenCalled();
  });

  it('delivers transitions to every subscribed listener', () => {
    const state = new RuntimeReadyState();
    const first = jest.fn();
    const second = jest.fn();
    state.onReadyStateChange(first);
    state.onReadyStateChange(second);

    state.setReady(true);

    expect(first).toHaveBeenCalledWith(true);
    expect(second).toHaveBeenCalledWith(true);
  });

  it('forwards listener errors to the optional handler and still notifies other listeners', () => {
    const thrown = new Error('listener blew up');
    const onListenerError = jest.fn();
    const state = new RuntimeReadyState(onListenerError);
    const failing = jest.fn(() => {
      throw thrown;
    });
    const healthy = jest.fn();
    state.onReadyStateChange(failing);
    state.onReadyStateChange(healthy);

    state.setReady(true);

    expect(onListenerError).toHaveBeenCalledTimes(1);
    expect(onListenerError).toHaveBeenCalledWith(thrown);
    expect(failing).toHaveBeenCalledWith(true);
    expect(healthy).toHaveBeenCalledWith(true);
  });

  it('swallows listener errors when no error handler is configured', () => {
    const state = new RuntimeReadyState();
    const failing = jest.fn(() => {
      throw new Error('no handler');
    });
    const healthy = jest.fn();
    state.onReadyStateChange(failing);
    state.onReadyStateChange(healthy);

    expect(() => state.setReady(true)).not.toThrow();
    expect(healthy).toHaveBeenCalledWith(true);
  });
});
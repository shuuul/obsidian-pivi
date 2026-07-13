import { act, renderHook } from '@testing-library/react';
import {
  ChatUiStore,
  createInitialChatUiSnapshot,
  useChatUiSnapshot,
} from '@pivi/obsidian-react/store';

describe('ChatUiStore', () => {
  it('publishes immutable, structurally cloneable snapshots', () => {
    const store = new ChatUiStore();
    const message = {
      id: 'assistant-1',
      role: 'assistant' as const,
      content: 'Hello',
      timestamp: 1,
    };

    store.update({
      messages: [message],
      queuedTurn: {
        content: 'next',
        imageCount: 1,
        hasEditorContext: true,
        hasBrowserContext: false,
        hasCanvasContext: false,
      },
    });

    const snapshot = store.getSnapshot();
    expect(JSON.parse(JSON.stringify(snapshot))).toEqual(snapshot);
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.messages)).toBe(true);
    expect(Object.isFrozen(snapshot.messages[0])).toBe(true);
    expect(snapshot).not.toHaveProperty('currentTextEl');
    expect(snapshot).not.toHaveProperty('controller');
    expect(snapshot).not.toHaveProperty('renderer');
    expect(snapshot).not.toHaveProperty('service');
    expect(snapshot).not.toHaveProperty('timer');
  });

  it('keeps untouched snapshot branches stable and notifies React through useSyncExternalStore', () => {
    const initial = createInitialChatUiSnapshot();
    initial.messages = [{
      id: 'user-1',
      role: 'user',
      content: 'Hello',
      timestamp: 1,
    }];
    const store = new ChatUiStore(initial);
    const initialMessages = store.getSnapshot().messages;
    const { result } = renderHook(() => useChatUiSnapshot(store));

    act(() => store.update({ isStreaming: true }));

    expect(result.current.isStreaming).toBe(true);
    expect(result.current.messages).toBe(initialMessages);
  });

  it('rejects runtime objects that cannot be structurally cloned', () => {
    const store = new ChatUiStore();
    expect(() => store.update({
      queuedTurn: {
        content: 'invalid',
        imageCount: 0,
        hasEditorContext: false,
        hasBrowserContext: false,
        hasCanvasContext: false,
        runtimeCallback: () => undefined,
      } as never,
    })).toThrow();
  });


  it('stores immutable thinkingIndicator presentation snapshots', () => {
    const store = new ChatUiStore();
    expect(store.getSnapshot().thinkingIndicator).toBeNull();

    store.update({
      thinkingIndicator: {
        text: 'Thinking...',
        className: 'pivi-thinking',
        elapsedLabel: ' (esc to interrupt · 0:01)',
      },
    });

    const snapshot = store.getSnapshot();
    expect(snapshot.thinkingIndicator).toEqual({
      text: 'Thinking...',
      className: 'pivi-thinking',
      elapsedLabel: ' (esc to interrupt · 0:01)',
    });
    expect(Object.isFrozen(snapshot.thinkingIndicator)).toBe(true);

    store.update({ thinkingIndicator: null });
    expect(store.getSnapshot().thinkingIndicator).toBeNull();
  });
});

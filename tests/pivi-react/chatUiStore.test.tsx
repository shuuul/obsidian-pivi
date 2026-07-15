import { act, renderHook } from '@testing-library/react';
import {
  ChatUiStore,
  ChatProjectionStore,
  createInitialChatUiSnapshot,
  useChatUiSnapshot,
} from '@pivi/pivi-react/store';

describe('ChatUiStore', () => {
  it('publishes immutable, structurally cloneable snapshots', () => {
    const store = new ChatUiStore();

    store.update({
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
    expect(Object.isFrozen(snapshot.queuedTurn)).toBe(true);
    expect(snapshot).not.toHaveProperty('currentTextEl');
    expect(snapshot).not.toHaveProperty('controller');
    expect(snapshot).not.toHaveProperty('renderer');
    expect(snapshot).not.toHaveProperty('service');
    expect(snapshot).not.toHaveProperty('timer');
  });

  it('keeps untouched snapshot branches stable and notifies React through useSyncExternalStore', () => {
    const initial = createInitialChatUiSnapshot();
    const store = new ChatUiStore(initial);
    const initialComposer = store.getSnapshot().composer;
    const { result } = renderHook(() => useChatUiSnapshot(store));

    act(() => store.update({ isStreaming: true }));

    expect(result.current.isStreaming).toBe(true);
    expect(result.current.composer).toBe(initialComposer);
  });

  it('preserves unchanged projection identities while replacing one message entity', () => {
    const store = new ChatProjectionStore();
    const historical = { id: 'user-1', role: 'user' as const, content: 'Hello', timestamp: 1 };
    const streaming = { id: 'assistant-1', role: 'assistant' as const, content: '', timestamp: 2 };
    store.replaceAll([historical, streaming]);
    const beforeHistorical = store.getMessageSnapshot('user-1');
    const beforeStreaming = store.getMessageSnapshot('assistant-1');

    store.upsertNow({ ...streaming, content: 'chunk' });

    expect(store.getMessageSnapshot('user-1')).toBe(beforeHistorical);
    expect(store.getMessageSnapshot('assistant-1')).not.toBe(beforeStreaming);
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

describe('ChatProjectionStore', () => {
  it('coalesces hundreds of updates for one entity into one animation-frame commit', () => {
    let frame: FrameRequestCallback | null = null;
    const ownerWindow = {
      requestAnimationFrame: jest.fn((callback: FrameRequestCallback) => {
        frame = callback;
        return 1;
      }),
      cancelAnimationFrame: jest.fn(),
    } as unknown as Window;
    const store = new ChatProjectionStore();
    store.setOwnerWindow(ownerWindow);
    store.replaceAll([{ id: 'assistant-1', role: 'assistant', content: '', timestamp: 1 }]);
    const listener = jest.fn();
    store.subscribeMessage('assistant-1', listener);

    for (let index = 1; index <= 500; index += 1) {
      store.queueUpsert({
        id: 'assistant-1',
        role: 'assistant',
        content: `chunk-${index}`,
        timestamp: 1,
      });
    }

    expect(ownerWindow.requestAnimationFrame).toHaveBeenCalledTimes(1);
    expect(listener).not.toHaveBeenCalled();
    (frame as unknown as FrameRequestCallback)(0);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.getMessageSnapshot('assistant-1')?.content).toBe('chunk-500');
  });

  it('projects the latest 100 of a 5K session and prepends fixed in-memory pages', () => {
    const store = new ChatProjectionStore();
    const messages = Array.from({ length: 5_000 }, (_, index) => ({
      id: `message-${index}`,
      role: index % 2 === 0 ? 'user' as const : 'assistant' as const,
      content: `${index}`,
      timestamp: index,
    }));

    store.replaceAll(messages);
    expect(store.getOrderSnapshot()).toHaveLength(100);
    expect(store.getOrderSnapshot()[0]).toBe('message-4900');
    expect(store.prependPreviousPage()).toBe(true);
    expect(store.getOrderSnapshot()).toHaveLength(200);
    expect(store.getOrderSnapshot()[0]).toBe('message-4800');
    expect(store.getMessageSnapshot('message-4999')?.content).toBe('4999');
  });

  it('publishes block, tool, and agent-run entities without notifying unrelated messages', () => {
    const store = new ChatProjectionStore();
    store.replaceAll([
      { id: 'user-1', role: 'user', content: 'Question', timestamp: 1 },
      {
        id: 'assistant-1',
        role: 'assistant',
        content: 'Answer',
        timestamp: 2,
        contentBlocks: [{ type: 'text', content: 'Answer' }],
        toolCalls: [{
          id: 'tool-1',
          name: 'spawn_agent',
          input: {},
          status: 'running',
          subagent: {
            id: 'subagent-1',
            agentId: 'agent-1',
            description: 'Research',
            isExpanded: false,
            status: 'running',
            toolCalls: [],
          },
        }],
      },
    ]);
    const userListener = jest.fn();
    const blockListener = jest.fn();
    store.subscribeMessage('user-1', userListener);
    store.subscribeBlock('assistant-1:block:0', blockListener);

    store.upsertNow({
      id: 'assistant-1',
      role: 'assistant',
      content: 'Answer continued',
      timestamp: 2,
      contentBlocks: [{ type: 'text', content: 'Answer continued' }],
      toolCalls: [],
    });

    expect(userListener).not.toHaveBeenCalled();
    expect(blockListener).toHaveBeenCalledTimes(1);
    expect(store.getBlockSnapshot('assistant-1:block:0')?.block).toEqual({
      type: 'text',
      content: 'Answer continued',
    });
    expect(store.getToolSnapshot('tool-1')).toBeNull();
    expect(store.getAgentRunSnapshot('agent-1')).toBeNull();
  });
});

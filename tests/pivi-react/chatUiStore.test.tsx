import { act, renderHook } from '@testing-library/react';
import type { ChatMessage } from '@pivi/pivi-agent-core/foundation';
import {
  CHAT_PROJECTION_HIDDEN_CADENCE_MS,
  type ChatProjectionEvent,
  type ChatPerfRecorder,
  ChatUiStore,
  ChatProjectionStore,
  createInitialChatUiSnapshot,
  useChatUiSnapshot,
} from '@pivi/pivi-react/store';

function createProjectionRealm(initialVisibility: DocumentVisibilityState = 'visible') {
  let visibilityState = initialVisibility;
  let nextId = 0;
  const frames = new Map<number, FrameRequestCallback>();
  const timers = new Map<number, TimerHandler>();
  const visibilityListeners = new Set<EventListenerOrEventListenerObject>();
  const document = {
    get visibilityState() {
      return visibilityState;
    },
    addEventListener: jest.fn((type: string, listener: EventListenerOrEventListenerObject) => {
      if (type === 'visibilitychange') visibilityListeners.add(listener);
    }),
    removeEventListener: jest.fn((type: string, listener: EventListenerOrEventListenerObject) => {
      if (type === 'visibilitychange') visibilityListeners.delete(listener);
    }),
  } as unknown as Document;
  const ownerWindow = {
    document,
    requestAnimationFrame: jest.fn((callback: FrameRequestCallback) => {
      const id = ++nextId;
      frames.set(id, callback);
      return id;
    }),
    cancelAnimationFrame: jest.fn((id: number) => frames.delete(id)),
    setTimeout: jest.fn((callback: TimerHandler) => {
      const id = ++nextId;
      timers.set(id, callback);
      return id;
    }),
    clearTimeout: jest.fn((id: number) => timers.delete(id)),
  } as unknown as Window;
  return {
    ownerWindow,
    fireFrame() {
      const entry = frames.entries().next().value as [number, FrameRequestCallback] | undefined;
      if (!entry) throw new Error('No pending animation frame');
      frames.delete(entry[0]);
      entry[1](0);
    },
    fireTimer() {
      const entry = timers.entries().next().value as [number, TimerHandler] | undefined;
      if (!entry) throw new Error('No pending timer');
      timers.delete(entry[0]);
      if (typeof entry[1] === 'function') entry[1]();
    },
    setVisibility(next: DocumentVisibilityState) {
      visibilityState = next;
      for (const listener of visibilityListeners) {
        if (typeof listener === 'function') listener(new Event('visibilitychange'));
        else listener.handleEvent(new Event('visibilitychange'));
      }
    },
  };
}

function queuedMessageEvent(message: ChatMessage, sequence: number): ChatProjectionEvent {
  return {
    type: 'message.upsert',
    projectionScopeId: 'test',
    sessionFile: null,
    openSessionId: null,
    runId: 'test:run:1',
    parentRunId: null,
    sequence,
    timestamp: sequence,
    messageId: message.id,
    blockId: null,
    toolId: null,
    agentId: null,
    message,
    delivery: 'queued',
  };
}

function textAppendEvent(
  message: ChatMessage,
  sequence: number,
  overrides: Partial<ChatProjectionEvent> = {},
): ChatProjectionEvent {
  return {
    type: 'text.append',
    projectionScopeId: 'test',
    sessionFile: null,
    openSessionId: null,
    runId: 'test:run:1',
    parentRunId: null,
    sequence,
    timestamp: sequence,
    messageId: message.id,
    blockId: `${message.id}:block:0`,
    toolId: null,
    agentId: null,
    message,
    delta: message.content,
    ...overrides,
  } as ChatProjectionEvent;
}

function terminalEvent(sequence: number): ChatProjectionEvent {
  return {
    type: 'run.terminal',
    projectionScopeId: 'test',
    sessionFile: null,
    openSessionId: null,
    runId: 'test:run:1',
    parentRunId: null,
    sequence,
    timestamp: sequence,
    messageId: null,
    blockId: null,
    toolId: null,
    agentId: null,
  };
}

function pageEvent(
  type: 'messages.reveal-previous-page' | 'messages.prepend-page',
  sequence: number,
  messages: readonly ChatMessage[] = [],
): ChatProjectionEvent {
  const metadata = {
    projectionScopeId: 'test',
    sessionFile: null,
    openSessionId: null,
    runId: 'test:run:1',
    parentRunId: null,
    sequence,
    timestamp: sequence,
    messageId: null,
    blockId: null,
    toolId: null,
    agentId: null,
  };
  return type === 'messages.prepend-page'
    ? { ...metadata, type, messages }
    : { ...metadata, type };
}

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
      store.dispatch(queuedMessageEvent({
        id: 'assistant-1',
        role: 'assistant',
        content: `chunk-${index}`,
        timestamp: 1,
      }, index));
    }

    expect(ownerWindow.requestAnimationFrame).toHaveBeenCalledTimes(1);
    expect(listener).not.toHaveBeenCalled();
    (frame as unknown as FrameRequestCallback)(0);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.getMessageSnapshot('assistant-1')?.content).toBe('chunk-500');
  });

  it('reports coalesced projection commits and their following paint only when enabled', () => {
    const frames: FrameRequestCallback[] = [];
    const ownerWindow = {
      requestAnimationFrame: jest.fn((callback: FrameRequestCallback) => {
        frames.push(callback);
        return frames.length;
      }),
      cancelAnimationFrame: jest.fn(),
    } as unknown as Window;
    let now = 0;
    const recorder: ChatPerfRecorder = {
      enabled: true,
      now: jest.fn(() => {
        now += 2;
        return now;
      }),
      onMarkdownRender: jest.fn(),
      onProjectionCommit: jest.fn(),
      onProjectionEvent: jest.fn(),
      onProjectionPaint: jest.fn(),
      onScrollAnchor: jest.fn(),
      onVirtualRows: jest.fn(),
    };
    const store = new ChatProjectionStore(recorder);
    store.setOwnerWindow(ownerWindow);

    store.dispatch(queuedMessageEvent(
      { id: 'assistant-1', role: 'assistant', content: 'a', timestamp: 1 },
      1,
    ));
    store.dispatch(queuedMessageEvent(
      { id: 'assistant-1', role: 'assistant', content: 'ab', timestamp: 1 },
      2,
    ));

    expect(recorder.onProjectionEvent).toHaveBeenCalledTimes(2);
    expect(frames).toHaveLength(1);
    frames.shift()?.(0);
    expect(recorder.onProjectionCommit).toHaveBeenCalledWith(
      'animation-frame',
      ['assistant-1'],
      2,
      ownerWindow,
    );
    expect(recorder.onProjectionPaint).not.toHaveBeenCalled();
    expect(frames).toHaveLength(1);
    frames.shift()?.(16);
    expect(recorder.onProjectionPaint).toHaveBeenCalledWith(
      'animation-frame',
      ['assistant-1'],
      ownerWindow,
    );
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
    expect(store.dispatch(pageEvent('messages.reveal-previous-page', 1))).toBe(true);
    expect(store.getOrderSnapshot()).toHaveLength(200);
    expect(store.getOrderSnapshot()[0]).toBe('message-4800');
    expect(store.getMessageSnapshot('message-4999')?.content).toBe('4999');
  });

  it('prepends a fetched page without replacing the visible range', () => {
    const store = new ChatProjectionStore();
    store.replaceAll([
      { id: 'message-100', role: 'user', content: 'recent', timestamp: 100 },
    ]);

    expect(store.dispatch(pageEvent('messages.prepend-page', 1, [
      { id: 'message-99', role: 'assistant', content: 'older', timestamp: 99 },
      { id: 'message-100', role: 'user', content: 'duplicate', timestamp: 100 },
    ]))).toBe(true);

    expect(store.getOrderSnapshot()).toEqual(['message-99', 'message-100']);
    expect(store.getMessageSnapshot('message-100')?.content).toBe('recent');
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
    expect(store.getAgentRunSnapshot('subagent-1')).toBeNull();
  });

  it('reconciles entity snapshots and notifies only changed entities', () => {
    const store = new ChatProjectionStore();
    const first = {
      id: 'assistant-1',
      role: 'assistant' as const,
      content: 'one\ntwo',
      timestamp: 1,
      contentBlocks: [
        { type: 'text' as const, content: 'one' },
        { type: 'text' as const, content: 'two' },
      ],
      toolCalls: [{
        id: 'tool-1',
        name: 'spawn_agent',
        input: {},
        status: 'running' as const,
        subagent: {
          id: 'subagent-1',
          agentId: 'agent-1',
          description: 'Research',
          isExpanded: false,
          status: 'running' as const,
          toolCalls: [],
        },
      }],
    };
    store.replaceAll([first]);
    const firstBlock = store.getBlockSnapshot('assistant-1:block:0');
    const secondBlock = store.getBlockSnapshot('assistant-1:block:1');
    const tool = store.getToolSnapshot('tool-1');
    const agent = store.getAgentRunSnapshot('subagent-1');
    const firstListener = jest.fn();
    const secondListener = jest.fn();
    const toolListener = jest.fn();
    const agentListener = jest.fn();
    store.subscribeBlock('assistant-1:block:0', firstListener);
    store.subscribeBlock('assistant-1:block:1', secondListener);
    store.subscribeTool('tool-1', toolListener);
    store.subscribeAgentRun('subagent-1', agentListener);

    store.upsertNow({
      ...first,
      content: 'one updated\ntwo',
      contentBlocks: [
        { type: 'text', content: 'one updated' },
        { type: 'text', content: 'two' },
      ],
    });

    expect(firstListener).toHaveBeenCalledTimes(1);
    expect(secondListener).not.toHaveBeenCalled();
    expect(store.getBlockSnapshot('assistant-1:block:0')).not.toBe(firstBlock);
    expect(store.getBlockSnapshot('assistant-1:block:1')).toBe(secondBlock);
    expect(store.getToolSnapshot('tool-1')).toBe(tool);
    expect(store.getAgentRunSnapshot('subagent-1')).toBe(agent);
    expect(toolListener).not.toHaveBeenCalled();
    expect(agentListener).not.toHaveBeenCalled();
  });

  it('notifies subscribers when projected entities are removed', () => {
    const store = new ChatProjectionStore();
    const message = {
      id: 'assistant-1',
      role: 'assistant' as const,
      content: 'one',
      timestamp: 1,
      contentBlocks: [{ type: 'text' as const, content: 'one' }],
      toolCalls: [{
        id: 'tool-1',
        name: 'spawn_agent',
        input: {},
        status: 'running' as const,
        subagent: {
          id: 'subagent-1',
          agentId: 'agent-1',
          description: 'Research',
          isExpanded: false,
          status: 'running' as const,
          toolCalls: [],
        },
      }],
    };
    store.replaceAll([message]);
    const blockListener = jest.fn();
    const toolListener = jest.fn();
    const agentListener = jest.fn();
    store.subscribeBlock('assistant-1:block:0', blockListener);
    store.subscribeTool('tool-1', toolListener);
    store.subscribeAgentRun('subagent-1', agentListener);

    store.upsertNow({
      ...message,
      content: '',
      contentBlocks: [],
      toolCalls: [],
    });

    expect(store.getBlockSnapshot('assistant-1:block:0')).toBeNull();
    expect(store.getToolSnapshot('tool-1')).toBeNull();
    expect(store.getAgentRunSnapshot('subagent-1')).toBeNull();
    expect(blockListener).toHaveBeenCalledTimes(1);
    expect(toolListener).toHaveBeenCalledTimes(1);
    expect(agentListener).toHaveBeenCalledTimes(1);
  });

  it('publishes subagent-only patches without replacing the owning tool entity', () => {
    const store = new ChatProjectionStore();
    store.replaceAll([{
      id: 'assistant-1',
      role: 'assistant',
      content: '',
      timestamp: 1,
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
    }]);
    const tool = store.getToolSnapshot('tool-1');
    const toolListener = jest.fn();
    const agentListener = jest.fn();
    store.subscribeTool('tool-1', toolListener);
    store.subscribeAgentRun('subagent-1', agentListener);

    store.dispatch(queuedMessageEvent({
      id: 'assistant-1',
      role: 'assistant',
      content: '',
      timestamp: 1,
      toolCalls: [{
        id: 'tool-1',
        name: 'spawn_agent',
        input: {},
        status: 'running',
        subagent: {
          id: 'subagent-1',
          agentId: 'agent-1',
          description: 'Updated research',
          isExpanded: false,
          status: 'running',
          toolCalls: [],
        },
      }],
    }, 1));
    store.flush();

    expect(store.getToolSnapshot('tool-1')).toBe(tool);
    expect(store.getAgentRunSnapshot('subagent-1')?.agent.description).toBe('Updated research');
    expect(toolListener).not.toHaveBeenCalled();
    expect(agentListener).toHaveBeenCalledTimes(1);
  });

  it('derives stable nested Agent runs with ownership, activity, usage, and terminal references', () => {
    const store = new ChatProjectionStore();
    store.replaceAll([{
      id: 'assistant-1',
      role: 'assistant',
      content: '',
      timestamp: 1,
      toolCalls: [{
        id: 'spawn-parent',
        name: 'spawn_agent',
        input: {},
        status: 'running',
        startedAt: 10,
        subagent: {
          id: 'run-parent',
          agentId: 'runtime-parent',
          description: 'Coordinate research',
          isExpanded: false,
          mode: 'async',
          prompt: 'Research the topic',
          status: 'running',
          startedAt: 12,
          toolCalls: [{
            id: 'read-active',
            name: 'read',
            input: {},
            status: 'running',
          }, {
            id: 'spawn-child',
            name: 'spawn_agent',
            input: {},
            status: 'completed',
            subagent: {
              id: 'run-child',
              agentId: 'runtime-child',
              completedAt: 30,
              description: 'Verify sources',
              isExpanded: false,
              result: 'Verified.',
              status: 'completed',
              toolCalls: [],
              usage: { inputTokens: 120, outputTokens: 20 },
            },
          }],
        },
      }],
    }]);

    expect(store.getAgentRunSnapshot('run-parent')).toMatchObject({
      agentId: 'runtime-parent',
      childRunIds: ['run-child'],
      currentActivity: { status: 'running', toolId: 'read-active', toolName: 'read' },
      messageId: 'assistant-1',
      mode: 'async',
      owningMessageId: 'assistant-1',
      owningToolId: 'spawn-parent',
      parentRunId: null,
      runId: 'run-parent',
      status: 'running',
      toolIds: ['read-active', 'spawn-child'],
    });
    expect(store.getAgentRunSnapshot('run-child')).toMatchObject({
      agentId: 'runtime-child',
      parentRunId: 'run-parent',
      runId: 'run-child',
      status: 'completed',
      terminalResult: { text: 'Verified.' },
      usage: { inputTokens: 120, outputTokens: 20 },
    });
    expect(store.getAgentRunSnapshot('runtime-parent')).toBeNull();
  });

  it('keeps the spawn run id stable when a runtime agent id arrives later', () => {
    const store = new ChatProjectionStore();
    const message = {
      id: 'assistant-1',
      role: 'assistant' as const,
      content: '',
      timestamp: 1,
      toolCalls: [{
        id: 'spawn-1',
        name: 'spawn_agent',
        input: {},
        status: 'running' as const,
        subagent: {
          id: 'run-1',
          description: 'Research',
          isExpanded: false,
          status: 'running' as const,
          toolCalls: [],
        },
      }],
    };
    store.replaceAll([message]);
    const listener = jest.fn();
    store.subscribeAgentRun('run-1', listener);

    store.upsertNow({
      ...message,
      toolCalls: [{
        ...message.toolCalls[0]!,
        subagent: { ...message.toolCalls[0]!.subagent, agentId: 'runtime-1' },
      }],
    });

    expect(store.getAgentRunSnapshot('run-1')?.agentId).toBe('runtime-1');
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('preserves message structure snapshots across content deltas and publishes shape changes', () => {
    const store = new ChatProjectionStore();
    const initial = {
      id: 'assistant-1',
      role: 'assistant' as const,
      content: 'one',
      timestamp: 1,
      contentBlocks: [{ type: 'text' as const, content: 'one' }],
    };
    store.replaceAll([initial]);
    const structure = store.getMessageStructureSnapshot(initial.id);
    const messageListener = jest.fn();
    const structureListener = jest.fn();
    store.subscribeMessage(initial.id, messageListener);
    store.subscribeMessageStructure(initial.id, structureListener);

    store.upsertNow({
      ...initial,
      content: 'one updated',
      contentBlocks: [{ type: 'text', content: 'one updated' }],
    });

    expect(messageListener).toHaveBeenCalledTimes(1);
    expect(structureListener).not.toHaveBeenCalled();
    expect(store.getMessageStructureSnapshot(initial.id)).toBe(structure);

    store.upsertNow({
      ...initial,
      content: 'one updated\ntwo',
      contentBlocks: [
        { type: 'text', content: 'one updated' },
        { type: 'text', content: 'two' },
      ],
    });

    expect(structureListener).toHaveBeenCalledTimes(1);
    expect(store.getMessageStructureSnapshot(initial.id)).not.toBe(structure);
  });

  it('publishes checkpoint content changes even when token estimates stay equal', () => {
    const store = new ChatProjectionStore();
    const initial = {
      id: 'checkpoint-1',
      role: 'assistant' as const,
      content: '',
      timestamp: 1,
      contentBlocks: [{
        type: 'context_compacted' as const,
        summary: 'First summary',
        tokensAfter: 100,
        tokensBefore: 1_000,
      }],
    };
    store.replaceAll([initial]);
    const listener = jest.fn();
    store.subscribeMessageStructure(initial.id, listener);

    store.upsertNow({
      ...initial,
      contentBlocks: [{
        type: 'context_compacted',
        summary: 'Updated summary',
        tokensAfter: 100,
        tokensBefore: 1_000,
      }],
    });

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('publishes inactive surfaces on the slower owner-realm cadence', () => {
    const realm = createProjectionRealm();
    const store = new ChatProjectionStore();
    store.setOwnerWindow(realm.ownerWindow);
    store.setSurfaceActive(false);
    const message = { id: 'assistant-1', role: 'assistant' as const, content: 'queued', timestamp: 1 };

    store.dispatch(queuedMessageEvent(message, 1));

    expect(realm.ownerWindow.requestAnimationFrame).not.toHaveBeenCalled();
    expect(realm.ownerWindow.setTimeout).toHaveBeenCalledWith(
      expect.any(Function),
      CHAT_PROJECTION_HIDDEN_CADENCE_MS,
    );
    expect(store.getMessageSnapshot(message.id)).toBeNull();
    realm.fireTimer();
    expect(store.getMessageSnapshot(message.id)?.content).toBe('queued');
  });

  it('uses the slower cadence while the active owner document is hidden', () => {
    const realm = createProjectionRealm('hidden');
    const store = new ChatProjectionStore();
    store.setOwnerWindow(realm.ownerWindow);

    store.dispatch(queuedMessageEvent({
      id: 'assistant-1',
      role: 'assistant',
      content: 'hidden',
      timestamp: 1,
    }, 1));

    expect(realm.ownerWindow.requestAnimationFrame).not.toHaveBeenCalled();
    expect(realm.ownerWindow.setTimeout).toHaveBeenCalledTimes(1);
  });

  it('publishes one complete pending projection when visibility returns', () => {
    const realm = createProjectionRealm('hidden');
    const store = new ChatProjectionStore();
    store.setOwnerWindow(realm.ownerWindow);
    const message = { id: 'assistant-1', role: 'assistant' as const, content: 'complete', timestamp: 1 };
    store.dispatch(queuedMessageEvent(message, 1));

    realm.setVisibility('visible');

    expect(realm.ownerWindow.clearTimeout).toHaveBeenCalledTimes(1);
    expect(store.getMessageSnapshot(message.id)?.content).toBe('complete');
    expect(realm.ownerWindow.requestAnimationFrame).not.toHaveBeenCalled();
  });

  it('publishes once when an inactive surface becomes active', () => {
    const realm = createProjectionRealm();
    const store = new ChatProjectionStore();
    store.setOwnerWindow(realm.ownerWindow);
    store.setSurfaceActive(false);
    const message = { id: 'assistant-1', role: 'assistant' as const, content: 'active', timestamp: 1 };
    store.dispatch(queuedMessageEvent(message, 1));

    store.setSurfaceActive(true);

    expect(realm.ownerWindow.clearTimeout).toHaveBeenCalledTimes(1);
    expect(store.getMessageSnapshot(message.id)?.content).toBe('active');
  });

  it('cancels the old owner realm before scheduling in a pop-out realm', () => {
    const main = createProjectionRealm();
    const popout = createProjectionRealm();
    const store = new ChatProjectionStore();
    store.setOwnerWindow(main.ownerWindow);
    store.dispatch(queuedMessageEvent({
      id: 'assistant-1',
      role: 'assistant',
      content: 'moving',
      timestamp: 1,
    }, 1));

    store.setOwnerWindow(popout.ownerWindow);

    expect(main.ownerWindow.cancelAnimationFrame).toHaveBeenCalledTimes(1);
    expect(main.ownerWindow.document.removeEventListener).toHaveBeenCalledWith(
      'visibilitychange',
      expect.any(Function),
    );
    expect(popout.ownerWindow.document.addEventListener).toHaveBeenCalledWith(
      'visibilitychange',
      expect.any(Function),
    );
    expect(popout.ownerWindow.requestAnimationFrame).toHaveBeenCalledTimes(1);
    popout.fireFrame();
    expect(store.getMessageSnapshot('assistant-1')?.content).toBe('moving');
  });

  it('flushes terminal events immediately during hidden cadence', () => {
    const realm = createProjectionRealm('hidden');
    const store = new ChatProjectionStore();
    store.setOwnerWindow(realm.ownerWindow);
    const message = { id: 'assistant-1', role: 'assistant' as const, content: 'done', timestamp: 1 };
    store.dispatch(queuedMessageEvent(message, 1));

    store.dispatch(terminalEvent(2));

    expect(realm.ownerWindow.clearTimeout).toHaveBeenCalledTimes(1);
    expect(store.getMessageSnapshot(message.id)?.content).toBe('done');
  });

  it('drops duplicate sequences idempotently and reports the event identity', () => {
    const diagnostic = jest.fn();
    const store = new ChatProjectionStore(undefined, diagnostic);
    const initial = { id: 'assistant-1', role: 'assistant' as const, content: 'one', timestamp: 1 };
    store.dispatch(queuedMessageEvent(initial, 1));
    store.flush();

    store.dispatch(queuedMessageEvent({ ...initial, content: 'duplicate' }, 1));

    expect(store.getMessageSnapshot(initial.id)?.content).toBe('one');
    expect(diagnostic).toHaveBeenCalledWith(expect.objectContaining({
      code: 'duplicate-sequence',
      eventType: 'message.upsert',
      sequence: 1,
    }));
  });

  it('snapshots accepted pending events before a rejected mutation can alias them', () => {
    const realm = createProjectionRealm();
    const diagnostic = jest.fn();
    const store = new ChatProjectionStore(undefined, diagnostic);
    store.setOwnerWindow(realm.ownerWindow);
    const message = {
      id: 'assistant-1',
      role: 'assistant' as const,
      content: 'accepted',
      timestamp: 1,
      contentBlocks: [{ type: 'text' as const, content: 'accepted' }],
    };
    store.dispatch(queuedMessageEvent(message, 1));

    message.content = 'rejected mutation';
    message.contentBlocks[0]!.content = 'rejected mutation';
    store.dispatch(textAppendEvent(message, 3));
    store.flush();

    expect(store.getMessageSnapshot(message.id)?.content).toBe('accepted');
    expect(diagnostic).toHaveBeenCalledWith(expect.objectContaining({
      code: 'out-of-order-sequence',
      sequence: 3,
    }));
  });

  it('drops out-of-order sequences without publishing their authoritative snapshot', () => {
    const diagnostic = jest.fn();
    const store = new ChatProjectionStore(undefined, diagnostic);
    const initial = {
      id: 'assistant-1',
      role: 'assistant' as const,
      content: 'one',
      timestamp: 1,
      contentBlocks: [{ type: 'text' as const, content: 'one' }],
    };
    store.dispatch(queuedMessageEvent(initial, 1));
    store.flush();

    store.dispatch(textAppendEvent({
      ...initial,
      content: 'one three',
      contentBlocks: [{ type: 'text', content: 'one three' }],
    }, 3));

    expect(store.getMessageSnapshot(initial.id)?.content).toBe('one');
    expect(diagnostic).toHaveBeenCalledWith(expect.objectContaining({
      code: 'out-of-order-sequence',
      eventType: 'text.append',
      sequence: 3,
    }));
  });

  it('drops entity events whose owning message is missing', () => {
    const diagnostic = jest.fn();
    const store = new ChatProjectionStore(undefined, diagnostic);
    const missing = {
      id: 'missing-assistant',
      role: 'assistant' as const,
      content: 'orphan',
      timestamp: 1,
      contentBlocks: [{ type: 'text' as const, content: 'orphan' }],
    };

    store.dispatch(textAppendEvent(missing, 1));

    expect(store.getMessageSnapshot(missing.id)).toBeNull();
    expect(diagnostic).toHaveBeenCalledWith(expect.objectContaining({
      code: 'missing-owner',
      eventType: 'text.append',
      messageId: missing.id,
    }));
  });

  it('drops message events that arrive after their run terminal', () => {
    const diagnostic = jest.fn();
    const store = new ChatProjectionStore(undefined, diagnostic);
    const initial = {
      id: 'assistant-1',
      role: 'assistant' as const,
      content: 'one',
      timestamp: 1,
      contentBlocks: [{ type: 'text' as const, content: 'one' }],
    };
    store.dispatch(queuedMessageEvent(initial, 1));
    store.dispatch(terminalEvent(2));

    store.dispatch(textAppendEvent({
      ...initial,
      content: 'late',
      contentBlocks: [{ type: 'text', content: 'late' }],
    }, 3));

    expect(store.getMessageSnapshot(initial.id)?.content).toBe('one');
    expect(diagnostic).toHaveBeenCalledWith(expect.objectContaining({
      code: 'late-after-terminal',
      eventType: 'text.append',
      sequence: 3,
    }));
  });
});

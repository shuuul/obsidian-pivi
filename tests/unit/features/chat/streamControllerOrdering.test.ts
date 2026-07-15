import type { StreamChunk } from '@pivi/pivi-agent-core/foundation';

import { StreamController } from '@/ui/chat/controllers/StreamController';
import { SubagentManager } from '@/ui/chat/services/SubagentManager';
import { ChatState } from '@/ui/chat/state/ChatState';

describe('StreamController background ordering', () => {
  it('serializes fire-and-forget background Agent chunks in arrival order', async () => {
    const state = new ChatState();
    state.addMessage({
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
    });
    const subagentManager = new SubagentManager(() => {});
    const controller = new StreamController({
      plugin: {} as never,
      settings: { getSettingsSnapshot: () => ({}) } as never,
      state,
      renderer: {} as never,
      subagentManager,
      getMessagesEl: () => ({
        ownerDocument: { defaultView: {} },
      }) as HTMLElement,
      getFileContextManager: () => null,
      updateQueueIndicator: () => {},
    });
    let releaseFirst!: () => void;
    const firstPending = new Promise<void>(resolve => { releaseFirst = resolve; });
    const handle = jest.spyOn(controller, 'handleStreamChunk')
      .mockImplementationOnce(() => firstPending)
      .mockResolvedValueOnce();
    const first: StreamChunk = {
      type: 'subagent_text',
      subagentId: 'subagent-1',
      content: 'first',
    };
    const second: StreamChunk = {
      type: 'subagent_text',
      subagentId: 'subagent-1',
      content: 'second',
    };

    const firstWork = controller.handleBackgroundSubagentChunk(first);
    const secondWork = controller.handleBackgroundSubagentChunk(second);
    await Promise.resolve();

    expect(handle).toHaveBeenCalledTimes(1);
    expect(handle).toHaveBeenNthCalledWith(1, first, expect.any(Object), {
      backgroundSubagent: true,
    });

    releaseFirst();
    await firstWork;
    await secondWork;

    expect(handle).toHaveBeenCalledTimes(2);
    expect(handle).toHaveBeenNthCalledWith(2, second, expect.any(Object), {
      backgroundSubagent: true,
    });
  });

  it('invalidates queued background work when the controller is disposed', async () => {
    const state = new ChatState();
    state.addMessage({
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
    });
    const controller = new StreamController({
      plugin: {} as never,
      settings: { getSettingsSnapshot: () => ({}) } as never,
      state,
      renderer: {} as never,
      subagentManager: new SubagentManager(() => {}),
      getMessagesEl: () => ({ ownerDocument: { defaultView: {} } }) as HTMLElement,
      getFileContextManager: () => null,
      updateQueueIndicator: () => {},
    });
    let releaseFirst!: () => void;
    const firstPending = new Promise<void>(resolve => { releaseFirst = resolve; });
    const handle = jest.spyOn(controller, 'handleStreamChunk')
      .mockImplementationOnce(() => firstPending)
      .mockResolvedValue();
    const first: StreamChunk = { type: 'subagent_text', subagentId: 'subagent-1', content: 'first' };
    const second: StreamChunk = { type: 'subagent_text', subagentId: 'subagent-1', content: 'second' };
    const firstWork = controller.handleBackgroundSubagentChunk(first);
    const secondWork = controller.handleBackgroundSubagentChunk(second);
    await Promise.resolve();

    controller.dispose();
    releaseFirst();
    await firstWork;
    await secondWork;

    expect(handle).toHaveBeenCalledTimes(1);
    await controller.handleBackgroundSubagentChunk(second);
    expect(handle).toHaveBeenCalledTimes(1);
  });

  it('does not publish an in-flight background chunk after disposal', async () => {
    const state = new ChatState();
    const message = {
      id: 'assistant-1',
      role: 'assistant' as const,
      content: '',
      timestamp: 1,
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
    state.addMessage(message);
    const controller = new StreamController({
      plugin: {} as never,
      settings: { getSettingsSnapshot: () => ({}) } as never,
      state,
      renderer: {} as never,
      subagentManager: new SubagentManager(() => {}),
      getMessagesEl: () => ({ ownerDocument: { defaultView: {} } }) as HTMLElement,
      getFileContextManager: () => null,
      updateQueueIndicator: () => {},
    });
    const coordinator = (controller as unknown as {
      subagentCoordinator: { handleSubagentChunk: (chunk: StreamChunk, message: unknown) => Promise<void> };
    }).subagentCoordinator;
    let release!: () => void;
    const pending = new Promise<void>(resolve => { release = resolve; });
    jest.spyOn(coordinator, 'handleSubagentChunk').mockImplementation(() => pending);
    const dispatch = jest.spyOn(state.projectionStore, 'dispatch');

    const work = controller.handleStreamChunk({
      type: 'subagent_tool_result',
      subagentId: 'subagent-1',
      id: 'nested-tool',
      content: 'done',
    }, message, { backgroundSubagent: true });
    await Promise.resolve();
    controller.dispose();
    release();
    await work;

    expect(dispatch.mock.calls.map(([event]) => event.type)).toEqual(['projection.flush']);
  });

  it('flushes an error projection immediately without sealing the run', async () => {
    const state = new ChatState();
    const message = {
      id: 'assistant-1',
      role: 'assistant' as const,
      content: '',
      timestamp: 1,
    };
    state.addMessage(message);
    const flushProjection = jest.spyOn(state, 'flushProjection');
    const completeProjectionRun = jest.spyOn(state, 'completeProjectionRun');
    const controller = new StreamController({
      plugin: {} as never,
      settings: { getSettingsSnapshot: () => ({}) } as never,
      state,
      renderer: {} as never,
      subagentManager: new SubagentManager(() => {}),
      getMessagesEl: () => ({
        ownerDocument: { defaultView: {} },
      }) as HTMLElement,
      getFileContextManager: () => null,
      updateQueueIndicator: () => {},
    });

    await controller.handleStreamChunk({ type: 'error', content: 'failed' }, message);

    expect(flushProjection).toHaveBeenCalledTimes(1);
    expect(completeProjectionRun).not.toHaveBeenCalled();
    expect(state.projectionStore.getMessageSnapshot(message.id)?.content).toContain('failed');
  });

  it('keeps a background Agent bound to the parent run that created it', async () => {
    const state = new ChatState({}, undefined, { projectionScopeId: 'tab-1' });
    state.bumpStreamGeneration();
    const subagent = {
      id: 'subagent-1',
      agentId: 'agent-1',
      description: 'Research',
      isExpanded: false,
      status: 'running' as const,
      asyncStatus: 'running' as const,
      mode: 'async' as const,
      toolCalls: [],
    };
    const message = {
      id: 'assistant-1',
      role: 'assistant' as const,
      content: '',
      timestamp: 1,
      toolCalls: [{
        id: 'tool-1',
        name: 'spawn_agent',
        input: {},
        status: 'running' as const,
        subagent,
      }],
    };
    state.addMessage(message);
    const controller = new StreamController({
      plugin: {} as never,
      settings: { getSettingsSnapshot: () => ({}) } as never,
      state,
      renderer: {} as never,
      subagentManager: new SubagentManager(() => {}),
      getMessagesEl: () => ({ ownerDocument: { defaultView: {} } }) as HTMLElement,
      getFileContextManager: () => null,
      updateQueueIndicator: () => {},
    });
    controller.onAsyncSubagentStateChange(subagent);
    state.bumpStreamGeneration();
    const dispatch = jest.spyOn(state.projectionStore, 'dispatch');

    await controller.handleStreamChunk({
      type: 'async_subagent_result',
      agentId: 'agent-1',
      subagentId: 'subagent-1',
      status: 'completed',
      result: 'done',
    }, message, { backgroundSubagent: true });

    const childEvents = dispatch.mock.calls
      .map(([event]) => event)
      .filter(event => event.type === 'agent.upsert' || event.type === 'run.terminal');
    expect(childEvents).toHaveLength(2);
    expect(childEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'agent.upsert',
        runId: 'tab-1:run:1:agent:subagent-1',
        parentRunId: 'tab-1:run:1',
      }),
      expect.objectContaining({
        type: 'run.terminal',
        runId: 'tab-1:run:1:agent:subagent-1',
        parentRunId: 'tab-1:run:1',
      }),
    ]));
  });
});

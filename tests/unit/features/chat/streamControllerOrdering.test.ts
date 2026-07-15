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
});

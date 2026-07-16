import type { ChatMessage } from '@pivi/pivi-agent-core/foundation';
import type { TaskResultInterpreter } from '@pivi/pivi-agent-core/tools';

import { SubagentManager } from '@/ui/chat/services/SubagentManager';
import { StreamSubagentCoordinator } from '@/ui/chat/stream/streamSubagentLifecycle';
import { ChatState } from '@/ui/chat/state/ChatState';

const mockInterpreter: TaskResultInterpreter = {
  hasAsyncLaunchMarker: () => false,
  extractAgentId: () => null,
  extractStructuredResult: () => null,
  resolveTerminalStatus: (_result, fallback) => fallback,
  extractTagValue: () => null,
};

function createCoordinator(onChange = jest.fn()) {
  const subagentManager = new SubagentManager(onChange, mockInterpreter);
  const state = new ChatState();
  const showThinkingIndicator = jest.fn();
  const hideThinkingIndicator = jest.fn();
  const scrollToBottom = jest.fn();
  const coordinator = new StreamSubagentCoordinator({
    state,
    subagentManager,
    showThinkingIndicator,
    hideThinkingIndicator,
    scrollToBottom,
  });
  return { coordinator, subagentManager, showThinkingIndicator, hideThinkingIndicator, scrollToBottom };
}

function createMessage(): ChatMessage {
  return {
    id: 'assistant-1',
    role: 'assistant',
    content: '',
    timestamp: Date.now(),
    toolCalls: [],
    contentBlocks: [],
  };
}

describe('StreamSubagentCoordinator', () => {
  it('records a sync task tool use on the assistant message', () => {
    const { coordinator, subagentManager } = createCoordinator();
    const msg = createMessage();

    coordinator.handleTaskToolUseViaManager(
      { type: 'tool_use', id: 'task-1', name: 'Task', input: { prompt: 'Inspect', run_in_background: false } },
      msg,
    );

    expect(subagentManager.getSyncSubagent('task-1')).toMatchObject({
      id: 'task-1',
      mode: 'sync',
      prompt: 'Inspect',
    });
    expect(msg.toolCalls).toEqual([
      expect.objectContaining({ id: 'task-1', name: 'Task', subagent: expect.objectContaining({ id: 'task-1' }) }),
    ]);
    expect(msg.contentBlocks).toEqual([{ type: 'subagent', subagentId: 'task-1' }]);
  });

  it('shows the thinking indicator for buffered async tasks', () => {
    const { coordinator, showThinkingIndicator } = createCoordinator();
    const msg = createMessage();

    coordinator.handleTaskToolUseViaManager(
      { type: 'tool_use', id: 'spawn-1', name: 'spawn_agent', input: { prompt: 'Research', run_in_background: true } },
      msg,
    );

    expect(showThinkingIndicator).toHaveBeenCalled();
    expect(msg.contentBlocks).toEqual([{ type: 'subagent', subagentId: 'spawn-1', mode: 'async' }]);
  });

  it('finalizes sync subagent tool results on the task tool call', () => {
    const { coordinator, hideThinkingIndicator, subagentManager } = createCoordinator();
    const msg = createMessage();
    coordinator.handleTaskToolUseViaManager(
      { type: 'tool_use', id: 'task-1', name: 'Task', input: { prompt: 'Inspect', run_in_background: false } },
      msg,
    );

    coordinator.finalizeSubagent(
      { type: 'tool_result', id: 'task-1', content: 'done', isError: false },
      msg,
    );

    expect(subagentManager.getSyncSubagent('task-1')).toMatchObject({ status: 'completed', result: 'done' });
    expect(msg.toolCalls?.[0]).toMatchObject({ status: 'completed', result: 'done' });
    expect(hideThinkingIndicator).toHaveBeenCalledTimes(1);
  });

  it('hides the foreground indicator when an async subagent finishes', async () => {
    const { coordinator, hideThinkingIndicator, subagentManager } = createCoordinator();
    coordinator.handleTaskToolUseViaManager(
      { type: 'tool_use', id: 'spawn-1', name: 'spawn_agent', input: { prompt: 'Research', run_in_background: true } },
      createMessage(),
    );
    subagentManager.handleTaskToolResult('spawn-1', 'agent_id: agent-1');

    await coordinator.handleAsyncSubagentResult({
      type: 'async_subagent_result',
      agentId: 'agent-1',
      status: 'completed',
      result: 'Done',
      subagentId: 'spawn-1',
    });

    expect(hideThinkingIndicator).toHaveBeenCalledTimes(1);
  });

  it('does not hide a foreground indicator for a background subagent result', async () => {
    const { coordinator, hideThinkingIndicator, subagentManager } = createCoordinator();
    coordinator.handleTaskToolUseViaManager(
      { type: 'tool_use', id: 'spawn-1', name: 'spawn_agent', input: { prompt: 'Research', run_in_background: true } },
      createMessage(),
    );
    subagentManager.handleTaskToolResult('spawn-1', 'agent_id: agent-1');

    await coordinator.handleAsyncSubagentResult({
      type: 'async_subagent_result',
      agentId: 'agent-1',
      status: 'completed',
      result: 'Done',
      subagentId: 'spawn-1',
    }, { showThinkingIndicator: false });

    expect(hideThinkingIndicator).not.toHaveBeenCalled();
  });

  it('swallows duplicate async task tool results after async completion', () => {
    const { coordinator, subagentManager } = createCoordinator();
    coordinator.handleTaskToolUseViaManager(
      { type: 'tool_use', id: 'spawn-1', name: 'spawn_agent', input: { prompt: 'Research', run_in_background: true } },
      createMessage(),
    );
    subagentManager.handleTaskToolResult('spawn-1', 'agent_id: agent-1');
    subagentManager.handleAsyncSubagentResult('agent-1', 'completed', 'Done', 'spawn-1');

    expect(coordinator.handleAsyncTaskToolResult({
      type: 'tool_result',
      id: 'spawn-1',
      content: 'Done',
      isError: false,
    })).toBe(true);
  });

  it('scrolls on async subagent state changes and tolerates stream reset', () => {
    const { coordinator, scrollToBottom } = createCoordinator();
    const msg = createMessage();
    coordinator.handleTaskToolUseViaManager(
      { type: 'tool_use', id: 'spawn-1', name: 'spawn_agent', input: { prompt: 'Research', run_in_background: true } },
      msg,
    );

    coordinator.onAsyncSubagentStateChange({
      id: 'spawn-1',
      description: 'Research',
      isExpanded: false,
      status: 'running',
      toolCalls: [],
      mode: 'async',
    });
    expect(scrollToBottom).toHaveBeenCalled();

    expect(() => coordinator.resetStreamingState()).not.toThrow();
  });

  it('retries async final-result hydration when the runtime has no result yet', async () => {
    jest.useFakeTimers();
    const loadSubagentFinalResult = jest.fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce('Recovered');
    const loadSubagentToolCalls = jest.fn().mockResolvedValue([]);
    const getAgentService = jest.fn(() => ({
      loadSubagentFinalResult,
      loadSubagentToolCalls,
    }));
    const onChange = jest.fn();
    const subagentManager = new SubagentManager(onChange, mockInterpreter);
    const state = new ChatState();
    const coordinator = new StreamSubagentCoordinator({
      state,
      subagentManager,
      getAgentService: getAgentService as never,
      showThinkingIndicator: jest.fn(),
      hideThinkingIndicator: jest.fn(),
      scrollToBottom: jest.fn(),
    });

    coordinator.handleTaskToolUseViaManager(
      { type: 'tool_use', id: 'spawn-1', name: 'spawn_agent', input: { prompt: 'Research', run_in_background: true } },
      createMessage(),
    );
    subagentManager.handleTaskToolResult('spawn-1', 'agent_id: agent-1');

    await coordinator.handleAsyncSubagentResult({
      type: 'async_subagent_result',
      agentId: 'agent-1',
      status: 'completed',
      result: '',
      subagentId: 'spawn-1',
    });

    expect(loadSubagentFinalResult).toHaveBeenCalledTimes(1);

    await jest.advanceTimersByTimeAsync(200);
    expect(loadSubagentFinalResult).toHaveBeenCalledTimes(2);

    expect(subagentManager.getByTaskId('spawn-1')?.result).toBe('Recovered');
    jest.useRealTimers();
  });

  it.each(['reset', 'dispose'] as const)(
    'cancels scheduled hydration retries on %s',
    async (lifecycleAction) => {
      jest.useFakeTimers();
      const loadSubagentFinalResult = jest.fn().mockResolvedValue(null);
      const subagentManager = new SubagentManager(jest.fn(), mockInterpreter);
      const coordinator = new StreamSubagentCoordinator({
        state: new ChatState(),
        subagentManager,
        getAgentService: (() => ({ loadSubagentFinalResult })) as never,
        showThinkingIndicator: jest.fn(),
        hideThinkingIndicator: jest.fn(),
        scrollToBottom: jest.fn(),
      });
      coordinator.handleTaskToolUseViaManager(
        { type: 'tool_use', id: 'spawn-1', name: 'spawn_agent', input: { prompt: 'Research', run_in_background: true } },
        createMessage(),
      );
      subagentManager.handleTaskToolResult('spawn-1', 'agent_id: agent-1');

      await coordinator.handleAsyncSubagentResult({
        type: 'async_subagent_result',
        agentId: 'agent-1',
        status: 'completed',
        result: '',
        subagentId: 'spawn-1',
      });
      lifecycleAction === 'reset'
        ? coordinator.resetStreamingState()
        : coordinator.dispose();

      await jest.advanceTimersByTimeAsync(2_000);
      expect(loadSubagentFinalResult).toHaveBeenCalledTimes(1);
      jest.useRealTimers();
    },
  );

  it('ignores an in-flight hydration result after reset', async () => {
    let resolveFinalResult: (result: string | null) => void = () => undefined;
    const loadSubagentFinalResult = jest.fn(() => new Promise<string | null>((resolve) => {
      resolveFinalResult = resolve;
    }));
    const subagentManager = new SubagentManager(jest.fn(), mockInterpreter);
    const coordinator = new StreamSubagentCoordinator({
      state: new ChatState(),
      subagentManager,
      getAgentService: (() => ({ loadSubagentFinalResult })) as never,
      showThinkingIndicator: jest.fn(),
      hideThinkingIndicator: jest.fn(),
      scrollToBottom: jest.fn(),
    });
    coordinator.handleTaskToolUseViaManager(
      { type: 'tool_use', id: 'spawn-1', name: 'spawn_agent', input: { prompt: 'Research', run_in_background: true } },
      createMessage(),
    );
    subagentManager.handleTaskToolResult('spawn-1', 'agent_id: agent-1');

    const hydration = coordinator.handleAsyncSubagentResult({
      type: 'async_subagent_result',
      agentId: 'agent-1',
      status: 'completed',
      result: '',
      subagentId: 'spawn-1',
    });
    await Promise.resolve();
    const resultBeforeReset = subagentManager.getByTaskId('spawn-1')?.result;
    coordinator.resetStreamingState();
    resolveFinalResult('Stale result');
    await hydration;

    expect(subagentManager.getByTaskId('spawn-1')?.result).toBe(resultBeforeReset);
  });

  it('captures loader rejection and retries hydration', async () => {
    jest.useFakeTimers();
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const loadSubagentFinalResult = jest.fn()
      .mockRejectedValueOnce(new Error('not ready'))
      .mockResolvedValueOnce('Recovered');
    const subagentManager = new SubagentManager(jest.fn(), mockInterpreter);
    const coordinator = new StreamSubagentCoordinator({
      state: new ChatState(),
      subagentManager,
      getAgentService: (() => ({ loadSubagentFinalResult })) as never,
      showThinkingIndicator: jest.fn(),
      hideThinkingIndicator: jest.fn(),
      scrollToBottom: jest.fn(),
    });
    coordinator.handleTaskToolUseViaManager(
      { type: 'tool_use', id: 'spawn-1', name: 'spawn_agent', input: { prompt: 'Research', run_in_background: true } },
      createMessage(),
    );
    subagentManager.handleTaskToolResult('spawn-1', 'agent_id: agent-1');

    await expect(coordinator.handleAsyncSubagentResult({
      type: 'async_subagent_result',
      agentId: 'agent-1',
      status: 'completed',
      result: '',
      subagentId: 'spawn-1',
    })).resolves.toBeUndefined();
    await jest.advanceTimersByTimeAsync(200);

    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('failed to hydrate final result'),
      expect.any(Error),
    );
    expect(subagentManager.getByTaskId('spawn-1')?.result).toBe('Recovered');
    warn.mockRestore();
    jest.useRealTimers();
  });
});

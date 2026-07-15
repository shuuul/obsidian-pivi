import { SubagentManager } from '@/ui/chat/services/SubagentManager';
import { extractFullOutputPath } from '@/ui/chat/services/subagentOutput';
import type { SubagentInfo } from '@pivi/pivi-agent-core/foundation';
import type { TaskResultInterpreter } from '@pivi/pivi-agent-core/tools';

const mockInterpreter: TaskResultInterpreter = {
  hasAsyncLaunchMarker: () => false,
  extractAgentId: () => null,
  extractStructuredResult: () => null,
  resolveTerminalStatus: (_result, fallback) => fallback,
  extractTagValue: () => null,
};

function createManager(onChange = jest.fn()): SubagentManager {
  return new SubagentManager(onChange, mockInterpreter);
}

describe('SubagentManager', () => {
  it('buffers a task until its mode becomes known', () => {
    const manager = createManager();

    expect(manager.handleTaskToolUse('task-1', { prompt: 'do thing' })).toEqual({ action: 'buffered' });
    expect(manager.hasPendingTask('task-1')).toBe(true);
    expect(manager.subagentsSpawnedThisStream).toBe(0);
  });

  it('resolves buffered task state when run_in_background arrives later', () => {
    const manager = createManager();
    manager.handleTaskToolUse('task-1', { prompt: 'read first' });

    const result = manager.handleTaskToolUse('task-1', { run_in_background: false });

    expect(result).toMatchObject({ action: 'created_sync', info: { id: 'task-1', mode: 'sync', prompt: 'read first' } });
    expect(manager.getSyncSubagent('task-1')).toBe(result.action === 'created_sync' ? result.info : undefined);
  });

  it('preserves terminal async records by task id without a rendered state', () => {
    const manager = createManager();
    const created = manager.handleTaskToolUse('spawn-1', { run_in_background: true, prompt: 'Research' });
    expect(created.action).toBe('created_async');

    manager.handleTaskToolResult('spawn-1', 'agent_id: agent-1');
    const handled = manager.handleAsyncSubagentResult('agent-1', 'completed', 'Done', 'spawn-1');

    expect(handled).toMatchObject({ id: 'spawn-1', agentId: 'agent-1', status: 'completed', asyncStatus: 'completed', result: 'Done' });
    expect(manager.getByTaskId('spawn-1')).toBe(handled);
  });

  it('updates pure records and emits state changes for nested sync tools', () => {
    const onChange = jest.fn();
    const manager = createManager(onChange);
    const created = manager.handleTaskToolUse('task-1', { run_in_background: false, prompt: 'Inspect' });
    if (created.action !== 'created_sync') throw new Error('sync task expected');

    manager.addSyncToolCall('task-1', {
      id: 'tool-1', name: 'bash', input: { command: 'pwd' }, status: 'running', isExpanded: false,
    });
    manager.updateSyncToolResult('task-1', 'tool-1', {
      id: 'tool-1', name: 'bash', input: { command: 'pwd' }, status: 'completed', isExpanded: false, result: 'ok',
    });

    expect(created.info.toolCalls).toEqual([expect.objectContaining({ id: 'tool-1', status: 'completed', result: 'ok' })]);
    expect(onChange).toHaveBeenLastCalledWith(created.info);
  });

  it('marks pending async work orphaned while retaining its record', () => {
    const manager = createManager();
    const created = manager.handleTaskToolUse('spawn-1', { run_in_background: true });
    if (created.action !== 'created_async') throw new Error('async task expected');

    expect(manager.orphanAllActive()).toEqual([created.info]);
    expect(manager.getByTaskId('spawn-1')).toMatchObject({ asyncStatus: 'orphaned', status: 'error' });
  });

  it('moves pre-activity async work to running on its first child event', () => {
    const manager = createManager();
    const created = manager.handleTaskToolUse('spawn-1', { run_in_background: true });
    if (created.action !== 'created_async') throw new Error('async task expected');

    manager.appendSubagentText('spawn-1', 'Started');

    expect(created.info).toMatchObject({
      asyncStatus: 'running',
      activityStatus: 'running',
      result: 'Started',
      startedAt: expect.any(Number),
    });
    expect(manager.hasRunningSubagents()).toBe(true);

    manager.handleTaskToolResult('spawn-1', 'agent_id: agent-1');
    expect(created.info).toMatchObject({ agentId: 'agent-1', asyncStatus: 'running' });
  });

  it('preserves explicit cancellation separately from the legacy error status', () => {
    const manager = createManager();
    const created = manager.handleTaskToolUse('spawn-1', { run_in_background: true });
    if (created.action !== 'created_async') throw new Error('async task expected');

    manager.handleTaskToolResult('spawn-1', 'Cancelled', true, { activity_status: 'cancelled' });

    expect(created.info).toMatchObject({
      status: 'error',
      asyncStatus: 'error',
      activityStatus: 'cancelled',
      result: 'Cancelled',
    });
  });

  it('resets the spawned count', () => {
    const manager = createManager();
    manager.handleTaskToolUse('task-1', { run_in_background: false });
    manager.resetSpawnedCount();
    expect(manager.subagentsSpawnedThisStream).toBe(0);
  });
});

describe('subagent output helpers', () => {
  it('extracts a trimmed full output path from truncated output text', () => {
    expect(extractFullOutputPath('before [Truncated. Full output: /tmp/agent.output ] after')).toBe('/tmp/agent.output');
  });

  it('ignores missing full output markers', () => {
    expect(extractFullOutputPath('plain output')).toBeNull();
  });
});

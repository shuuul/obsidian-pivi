import { SubagentManager } from '@/ui/chat/services/SubagentManager';
import { extractFullOutputPath } from '@/ui/chat/services/subagentOutput';
import type { TaskResultInterpreter } from '@pivi/obsidian-tools';

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
  it('buffers task tool_use until parent element exists', () => {
    const manager = createManager();
    const result = manager.handleTaskToolUse('task-1', { prompt: 'do thing' }, null);
    expect(result.action).toBe('buffered');
    expect(manager.subagentsSpawnedThisStream).toBe(0);
  });

  it('buffers when run_in_background is not yet known', () => {
    const parent = {} as HTMLElement;
    const manager = createManager();
    const result = manager.handleTaskToolUse('task-2', { prompt: 'sync task' }, parent);
    expect(result.action).toBe('buffered');
    expect(manager.hasPendingTask('task-2')).toBe(true);
  });

  it('resets spawned count on resetSpawnedCount', () => {
    const manager = createManager();
    manager.resetSpawnedCount();
    expect(manager.subagentsSpawnedThisStream).toBe(0);
  });
});

describe('subagent output helpers', () => {
  it('extracts a trimmed full output path from truncated output text', () => {
    expect(extractFullOutputPath('before [Truncated. Full output: /tmp/agent.output ] after'))
      .toBe('/tmp/agent.output');
  });

  it('ignores missing full output markers', () => {
    expect(extractFullOutputPath('plain output')).toBeNull();
  });
});

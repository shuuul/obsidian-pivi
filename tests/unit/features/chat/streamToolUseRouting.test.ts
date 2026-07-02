import { TOOL_AGENT_OUTPUT, TOOL_TASK } from '@pivi/tools/toolNames';
import type { SubagentLifecycleAdapter } from '@pivi/tools';
import { routeToolUseStreamChunk } from '@/ui/chat/controllers/streamToolUseRouting';

function mockLifecycleAdapter(overrides: Partial<SubagentLifecycleAdapter> = {}): SubagentLifecycleAdapter {
  return {
    isHiddenTool: () => false,
    isSpawnTool: (name) => name === 'spawn_subagent',
    isWaitTool: () => false,
    isCloseTool: () => false,
    resolveSpawnToolIds: () => [],
    buildSubagentInfo: () => ({
      id: 'sub-1',
      description: 'test',
      isExpanded: false,
      status: 'running',
      toolCalls: [],
    }),
    extractSpawnResult: () => ({}),
    extractWaitResult: () => ({ statuses: {}, timedOut: false }),
    ...overrides,
  };
}

describe('routeToolUseStreamChunk', () => {
  it('routes Task-style subagent tools to subagent_task', () => {
    expect(routeToolUseStreamChunk(TOOL_TASK, null)).toBe('subagent_task');
  });

  it('routes agent output tool to agent_output', () => {
    expect(routeToolUseStreamChunk(TOOL_AGENT_OUTPUT, null)).toBe('agent_output');
  });

  it('routes lifecycle spawn tools when adapter marks them', () => {
    const adapter = mockLifecycleAdapter();
    expect(routeToolUseStreamChunk('spawn_subagent', adapter)).toBe('subagent_spawn');
  });

  it('routes hidden lifecycle tools', () => {
    const adapter = mockLifecycleAdapter({
      isHiddenTool: (name) => name === 'hidden_tool',
      isSpawnTool: () => false,
    });
    expect(routeToolUseStreamChunk('hidden_tool', adapter)).toBe('subagent_hidden');
  });

  it('defaults to regular for unknown tools', () => {
    expect(routeToolUseStreamChunk('Read', null)).toBe('regular');
  });
});

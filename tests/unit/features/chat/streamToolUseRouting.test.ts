import { TOOL_AGENT_OUTPUT, TOOL_TASK } from '@pivi/pivi-agent-core/tools/toolNames';
import type { SubagentLifecycleAdapter } from '@pivi/pivi-agent-core/tools';
import {
  routeToolUseStreamChunk,
  shouldProjectToolUseChunk,
} from '@/ui/chat/stream/ToolEventPresenter';

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

  it('projects only regular tools, leaving task, spawn, and hidden tools to lifecycle handlers', () => {
    const adapter = mockLifecycleAdapter({
      isHiddenTool: name => name === 'hidden_tool',
    });

    expect(shouldProjectToolUseChunk('Read', adapter)).toBe(true);
    expect(shouldProjectToolUseChunk(TOOL_TASK, adapter)).toBe(false);
    expect(shouldProjectToolUseChunk('spawn_subagent', adapter)).toBe(false);
    expect(shouldProjectToolUseChunk('hidden_tool', adapter)).toBe(false);
  });
});

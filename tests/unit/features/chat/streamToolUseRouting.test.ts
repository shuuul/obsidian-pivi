import { TOOL_AGENT_OUTPUT, TOOL_TASK } from '@pivi/agent/tools/toolNames';
import {
  routeToolUseStreamChunk,
  shouldProjectToolUseChunk,
} from '@/ui/chat/stream/ToolEventPresenter';

describe('routeToolUseStreamChunk', () => {
  it('routes Task-style subagent tools to subagent_task', () => {
    expect(routeToolUseStreamChunk(TOOL_TASK)).toBe('subagent_task');
  });

  it('routes agent output tool to agent_output', () => {
    expect(routeToolUseStreamChunk(TOOL_AGENT_OUTPUT)).toBe('agent_output');
  });

  it('defaults to regular for unknown tools', () => {
    expect(routeToolUseStreamChunk('Read')).toBe('regular');
  });

  it('projects only regular tools, leaving subagent tools to lifecycle handlers', () => {
    expect(shouldProjectToolUseChunk('Read')).toBe(true);
    expect(shouldProjectToolUseChunk(TOOL_TASK)).toBe(false);
    expect(shouldProjectToolUseChunk(TOOL_AGENT_OUTPUT)).toBe(false);
  });
});

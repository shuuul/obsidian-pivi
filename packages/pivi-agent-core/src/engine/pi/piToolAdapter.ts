import type { AgentTool, AgentToolResult } from '@earendil-works/pi-agent-core';

import type { ToolSpec } from '../../tools';

export function toPiAgentTool(spec: ToolSpec): AgentTool {
  return {
    name: spec.name,
    label: spec.label ?? spec.name,
    description: spec.description,
    parameters: spec.parameters,
    ...(spec.executionMode ? { executionMode: spec.executionMode } : {}),
    async execute(toolCallId, params, signal) {
      return await spec.execute(toolCallId, params, signal) as AgentToolResult<unknown>;
    },
  };
}

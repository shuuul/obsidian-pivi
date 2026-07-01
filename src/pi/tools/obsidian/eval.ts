import type { AgentTool } from '@earendil-works/pi-agent-core';

import { TOOL_OBSIDIAN_EVAL } from '../../../pi/tools/obsidianToolNames';
import { textResult } from '../toolResult';
import { requireApproval } from './approval';
import type { ObsidianToolDeps } from './deps';

export function createEvalTool(deps: ObsidianToolDeps): AgentTool {
  const { cli, vaultName, approve } = deps;
  return {
    name: TOOL_OBSIDIAN_EVAL,
    label: 'Obsidian eval',
    description: 'Execute JavaScript in Obsidian via CLI eval. High privilege — use only when necessary.',
    parameters: {
      type: 'object',
      properties: {
        code: { type: 'string' },
      },
      required: ['code'],
      additionalProperties: false,
    },
    async execute(_id, params) {
      const { code } = params as { code: string };
      const input = { code };
      await requireApproval(approve, TOOL_OBSIDIAN_EVAL, input);
      const out = await cli.run({
        vaultName,
        args: ['eval', `code=${JSON.stringify(code)}`],
      });
      return textResult(out);
    },
  };
}

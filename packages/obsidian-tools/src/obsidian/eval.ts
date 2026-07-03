import {
  textResult,
  TOOL_OBSIDIAN_EVAL,
  type ToolSpec,
} from '@pivi/pivi-agent-core/tools';

import { requireApproval } from './approval';
import type { ObsidianToolDeps } from './deps';

export function createEvalTool(deps: ObsidianToolDeps): ToolSpec {
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

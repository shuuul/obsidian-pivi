import type { AgentTool } from '@earendil-works/pi-agent-core';

import { TOOL_OBSIDIAN_COMMAND } from '../../../core/tools/obsidianToolNames';
import { textResult } from '../toolResult';
import { requireApproval } from './approval';
import type { ObsidianToolDeps } from './deps';

export function createCommandTool(deps: ObsidianToolDeps): AgentTool {
  const { cli, settings, vaultName, approve } = deps;
  return {
    name: TOOL_OBSIDIAN_COMMAND,
    label: 'Obsidian command',
    description: 'Execute an Obsidian palette command by id. Restricted by allowlist when configured.',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Command id' },
      },
      required: ['id'],
      additionalProperties: false,
    },
    async execute(_id, params) {
      const { id } = params as { id: string };
      const allowlist = settings.commandAllowlist;
      if (allowlist.length > 0 && !allowlist.includes(id)) {
        throw new Error(`Command not in allowlist: ${id}`);
      }
      const input = { id };
      await requireApproval(approve, TOOL_OBSIDIAN_COMMAND, input);
      const out = await cli.run({ vaultName, args: ['command', `id=${id}`] });
      return textResult(out || `Executed command ${id}`);
    },
  };
}

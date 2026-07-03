import {
  textResult,
  TOOL_OBSIDIAN_COMMAND,
  type ToolSpec,
} from '@pivi/pivi-agent-core/tools';

import type { ObsidianToolDeps } from './deps';

export function createCommandTool(deps: ObsidianToolDeps): ToolSpec {
  const { cli, settings, vaultName } = deps;
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
      const out = await cli.run({ vaultName, args: ['command', `id=${id}`] });
      return textResult(out || `Executed command ${id}`);
    },
  };
}

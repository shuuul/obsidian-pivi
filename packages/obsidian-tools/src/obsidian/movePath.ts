import {
  textResult,
  TOOL_OBSIDIAN_MOVE,
  type ToolSpec,
} from '@pivi/pivi-agent-core/tools';

import { requireApproval } from './approval';
import type { ObsidianToolDeps } from './deps';

function getStringField(input: Record<string, unknown>, key: string): string | undefined {
  const value = input[key];
  return typeof value === 'string' ? value : undefined;
}

export function createMovePathTool(deps: ObsidianToolDeps): ToolSpec {
  const { vault, approve } = deps;
  return {
    name: TOOL_OBSIDIAN_MOVE,
    label: 'Move path',
    description: 'Rename or move a vault file or folder with Obsidian FileManager so links update according to user settings.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Existing vault-relative file or folder path' },
        newPath: { type: 'string', description: 'New vault-relative file or folder path' },
      },
      required: ['path', 'newPath'],
      additionalProperties: false,
    },
    async execute(_id, params) {
      const input = params as Record<string, unknown>;
      const path = getStringField(input, 'path');
      const newPath = getStringField(input, 'newPath');
      if (!path || !newPath) {
        throw new Error('Invalid move input: path and newPath must be strings.');
      }
      await requireApproval(approve, TOOL_OBSIDIAN_MOVE, input);
      const result = await vault.movePath({ path, newPath });
      return textResult(`Moved ${result.path} to ${result.newPath}`, { ...result });
    },
  };
}

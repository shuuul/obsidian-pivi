import {
  textResult,
  TOOL_OBSIDIAN_MKDIR,
  type ToolSpec,
} from '@pivi/pivi-agent-core/tools';

import { requireApproval } from './approval';
import type { ObsidianToolDeps } from './deps';

function getStringField(input: Record<string, unknown>, key: string): string | undefined {
  const value = input[key];
  return typeof value === 'string' ? value : undefined;
}

export function createMkdirTool(deps: ObsidianToolDeps): ToolSpec {
  const { vault, approve } = deps;
  return {
    name: TOOL_OBSIDIAN_MKDIR,
    label: 'Create folder',
    description: 'Create a folder in the vault via Obsidian Vault API.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Vault-relative folder path to create' },
      },
      required: ['path'],
      additionalProperties: false,
    },
    async execute(_id, params) {
      const input = params as Record<string, unknown>;
      const path = getStringField(input, 'path');
      if (!path) {
        throw new Error('Invalid mkdir input: path must be a string.');
      }
      await requireApproval(approve, TOOL_OBSIDIAN_MKDIR, input);
      const result = await vault.createFolder(path);
      return textResult(`Created folder: ${result.path}`, { ...result });
    },
  };
}

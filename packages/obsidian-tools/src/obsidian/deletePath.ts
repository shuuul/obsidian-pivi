import {
  textResult,
  TOOL_OBSIDIAN_DELETE,
  type ToolSpec,
} from '@pivi/pivi-agent-core/tools';

import { requireApproval } from './approval';
import type { ObsidianToolDeps } from './deps';

function getStringField(input: Record<string, unknown>, key: string): string | undefined {
  const value = input[key];
  return typeof value === 'string' ? value : undefined;
}

export function createDeletePathTool(deps: ObsidianToolDeps): ToolSpec {
  const { vault, approve } = deps;
  return {
    name: TOOL_OBSIDIAN_DELETE,
    label: 'Delete path',
    description: 'Move a vault file or folder to trash using Obsidian FileManager. This follows the user trash settings and requires path= for folders.',
    parameters: {
      type: 'object',
      properties: {
        file: { type: 'string', description: 'Note title / wikilink name (files only)' },
        path: { type: 'string', description: 'Vault-relative file or folder path, e.g. folder/note.md or folder' },
      },
      additionalProperties: false,
    },
    async execute(_id, params) {
      const input = params as Record<string, unknown>;
      const file = getStringField(input, 'file');
      const path = getStringField(input, 'path');
      if (!file && !path) {
        throw new Error('Invalid delete input: file or path must be a string.');
      }
      await requireApproval(approve, TOOL_OBSIDIAN_DELETE, input);
      const result = await vault.trashPath({ file, path });
      return textResult(`Moved ${result.kind} to trash: ${result.path}`, { ...result });
    },
  };
}

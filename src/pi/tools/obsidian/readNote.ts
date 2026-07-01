import type { AgentTool } from '@earendil-works/pi-agent-core';

import { TOOL_OBSIDIAN_READ } from '../../../pi/tools/obsidianToolNames';
import { textResult } from '../toolResult';
import type { ObsidianToolDeps } from './deps';

function getStringField(input: Record<string, unknown>, key: string): string | undefined {
  const value = input[key];
  return typeof value === 'string' ? value : undefined;
}

export function createReadNoteTool(deps: ObsidianToolDeps): AgentTool {
  const { vault } = deps;
  return {
    name: TOOL_OBSIDIAN_READ,
    label: 'Read note',
    description: 'Read a note body via vault API (in-process). Prefer path= from context; file= resolves a wikilink-style name.',
    parameters: {
      type: 'object',
      properties: {
        file: { type: 'string', description: 'Note title / wikilink name (not a folder path)' },
        path: { type: 'string', description: 'Vault-relative path, e.g. folder/note.md' },
      },
      additionalProperties: false,
    },
    async execute(_id, params) {
      const input = params as Record<string, unknown>;
      const file = getStringField(input, 'file');
      const notePath = getStringField(input, 'path');
      if (!file && !notePath) {
        throw new Error('Invalid read note input: file or path must be a string.');
      }
      const result = await vault.readNote(file, notePath);
      return textResult(result.content, { path: result.path });
    },
  };
}

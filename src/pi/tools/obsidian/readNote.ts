import type { AgentTool } from '@earendil-works/pi-agent-core';

import { TOOL_OBSIDIAN_READ } from '../../../core/tools/obsidianToolNames';
import { textResult } from '../toolResult';
import type { ObsidianToolDeps } from './deps';

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
      const { file, path: notePath } = params as { file?: string; path?: string };
      const result = await vault.readNote(file, notePath);
      return textResult(result.content, { path: result.path });
    },
  };
}

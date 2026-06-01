import type { AgentTool } from '@earendil-works/pi-agent-core';

import { TOOL_OBSIDIAN_EDIT } from '../../../core/tools/obsidianToolNames';
import { textResult } from '../toolResult';
import { requireApproval } from './approval';
import type { ObsidianToolDeps } from './deps';

function requireStringParam(value: unknown, name: string): string {
  if (typeof value !== 'string') {
    throw new Error(`${name} must be a string.`);
  }
  return value;
}

export function createEditNoteTool(deps: ObsidianToolDeps): AgentTool {
  const { vault, approve } = deps;
  return {
    name: TOOL_OBSIDIAN_EDIT,
    label: 'Edit note',
    description:
      'Replace a unique substring in a note via vault API (path= or file=). '
      + 'old_string must match vault content exactly—copy from obsidian_read, including curly “ ” vs ASCII quotes. '
      + 'If it appears more than once, use replace_all or include more context. '
      + 'Prefer this over obsidian_write overwrite for large files; use obsidian_read or obsidian_search first.',
    parameters: {
      type: 'object',
      properties: {
        file: { type: 'string', description: 'Note title / wikilink name' },
        path: { type: 'string', description: 'Vault-relative path, e.g. folder/note.md' },
        old_string: { type: 'string', description: 'Exact text to find (must be unique unless replace_all)' },
        new_string: { type: 'string', description: 'Replacement text' },
        replace_all: {
          type: 'boolean',
          description: 'Replace every occurrence of old_string (default: first only, error if ambiguous)',
        },
      },
      required: ['old_string', 'new_string'],
      additionalProperties: false,
    },
    async execute(_id, params) {
      const input = params as Record<string, unknown>;
      await requireApproval(approve, TOOL_OBSIDIAN_EDIT, input);
      const result = await vault.editNote({
        file: input.file as string | undefined,
        path: input.path as string | undefined,
        old_string: requireStringParam(input.old_string, 'old_string'),
        new_string: requireStringParam(input.new_string, 'new_string'),
        replace_all: Boolean(input.replace_all),
      });
      const label = result.replacements === 1 ? 'replacement' : 'replacements';
      return textResult(`Edited ${result.path} (${result.replacements} ${label})`, {
        path: result.path,
        filePath: result.path,
        structuredPatch: result.structuredPatch,
        replacements: result.replacements,
      });
    },
  };
}

import {
  buildSubstringPatchHunks,
  textResult,
  TOOL_OBSIDIAN_EDIT,
  type ToolSpec,
} from '@pivi/pivi-agent-core/tools';

import { requireApproval } from './approval';
import type { ObsidianToolDeps } from './deps';

function requireStringParam(value: unknown, name: string): string {
  if (typeof value !== 'string') {
    throw new Error(`${name} must be a string.`);
  }
  return value;
}

function getStringField(input: Record<string, unknown>, key: string): string | undefined {
  const value = input[key];
  return typeof value === 'string' ? value : undefined;
}

export function createEditNoteTool(deps: ObsidianToolDeps): ToolSpec {
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
      const file = getStringField(input, 'file');
      const notePath = getStringField(input, 'path');
      if (!file && !notePath) {
        throw new Error('Invalid edit note input: file or path must be a string.');
      }
      const oldString = requireStringParam(input.old_string, 'old_string');
      const newString = requireStringParam(input.new_string, 'new_string');
      const result = await vault.editNote({
        file,
        path: notePath,
        old_string: oldString,
        new_string: newString,
        replace_all: Boolean(input.replace_all),
      });
      const label = result.replacements === 1 ? 'replacement' : 'replacements';
      return textResult(`Edited ${result.path} (${result.replacements} ${label})`, {
        path: result.path,
        filePath: result.path,
        structuredPatch: buildSubstringPatchHunks(oldString, newString),
        replacements: result.replacements,
      });
    },
  };
}

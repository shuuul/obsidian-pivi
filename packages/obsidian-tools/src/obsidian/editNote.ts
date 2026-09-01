import {
  buildSubstringPatchHunks,
  textResult,
  TOOL_OBSIDIAN_EDIT,
  type ToolSpec,
} from '@pivi/agent/tools';

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
  const { vault } = deps;
  return {
    name: TOOL_OBSIDIAN_EDIT,
    label: 'Replace text',
    description:
      'Replace exact text in a note via vault API (path= or file=). '
      + 'old_string must match vault content exactly—copy from obsidian_read, including curly “ ” vs ASCII quotes. '
      + 'Matching is unique by default; set replace_all=true only when every occurrence should change. '
      + 'Prefer this over obsidian_write overwrite for large files; use obsidian_read or obsidian_search first.',
    promptUsage: {
      summary:
        'Replace one exact local substring when content must be removed, moved, rewritten, or split with line endings. '
        + 'old_string does not need to contain a whole physical line: copy the shortest exact span that is unique, '
        + 'then repeat that span in new_string with `\\n` or `\\n\\n` inserted at the intended boundary. '
        + 'For example, split `First sentence.Second sentence` with old_string=`sentence.Second` '
        + 'and new_string=`sentence.\\n\\nSecond`; do not send the surrounding multi-thousand-character line. '
        + 'For transcript delimiters, use old_string=`>>` with new_string=`\\n\\n` to remove the delimiter, '
        + 'or new_string=`\\n\\n>>` to retain it at the start of the next block. '
        + 'Replacement is literal: text immediately outside old_string stays directly adjacent to new_string. '
        + 'Before new_string introduces block Markdown such as headings, lists, blockquotes/callouts, fenced code, or thematic breaks, '
        + 'inspect both physical-line boundaries and include the required line endings in the replacement. '
        + 'A heading marker must begin at a physical line start: if the source is `>> Target`, replacing only `Target` with `### Heading` '
        + 'produces `>> ### Heading`, not a heading. Include the delimiter in old_string and write the required `\\n\\n` into new_string. '
        + 'Matching is unique by default; set replace_all=true only when every exact occurrence should receive the identical replacement.',
      parameters:
        'Exactly one of `path` or `file`, plus exact `old_string` and `new_string`. '
        + 'Optional `replace_all: true` explicitly replaces every occurrence; otherwise an ambiguous match fails.',
    },
    parameters: {
      type: 'object',
      properties: {
        file: { type: 'string', description: 'Note title / wikilink name' },
        path: { type: 'string', description: 'Vault-relative path, e.g. folder/note.md' },
        old_string: { type: 'string', description: 'Exact text to find (must be unique unless replace_all)' },
        new_string: {
          type: 'string',
          description: 'Literal replacement text, including any line endings required by Markdown block boundaries',
        },
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

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
      + 'edits[].oldText must match vault content exactly—copy from read, including curly “ ” vs ASCII quotes. '
      + 'Matching is unique by default; set replaceAll=true only when every occurrence should change. '
      + 'Prefer this over write overwrite for large files; use read or search first.',
    promptUsage: {
      summary:
        'Replace one exact local substring when content must be removed, moved, rewritten, or split with line endings. '
        + 'oldText does not need to contain a whole physical line: copy the shortest exact span that is unique, '
        + 'then repeat that span in newText with `\\n` or `\\n\\n` inserted at the intended boundary. '
        + 'For example, split `First sentence.Second sentence` with oldText=`sentence.Second` '
        + 'and newText=`sentence.\\n\\nSecond`; do not send the surrounding multi-thousand-character line. '
        + 'For transcript delimiters, use oldText=`>>` with newText=`\\n\\n` to remove the delimiter, '
        + 'or newText=`\\n\\n>>` to retain it at the start of the next block. '
        + 'Replacement is literal: text immediately outside oldText stays directly adjacent to newText. '
        + 'Before newText introduces block Markdown such as headings, lists, blockquotes/callouts, fenced code, or thematic breaks, '
        + 'inspect both physical-line boundaries and include the required line endings in the replacement. '
        + 'A heading marker must begin at a physical line start: if the source is `>> Target`, replacing only `Target` with `### Heading` '
        + 'produces `>> ### Heading`, not a heading. Include the delimiter in oldText and write the required `\\n\\n` into newText. '
        + 'Matching is unique by default; set replaceAll=true only when every exact occurrence should receive the identical replacement.',
      parameters:
        '`path` or `file`, plus `edits: [{ oldText, newText, replaceAll? }]`. '
        + 'Optional `replaceAll: true` on an item replaces every occurrence; otherwise an ambiguous match fails.',
    },
    parameters: {
      type: 'object',
      properties: {
        file: { type: 'string', description: 'Note title / wikilink name' },
        path: { type: 'string', description: 'Vault-relative path, e.g. folder/note.md' },
        edits: {
          type: 'array',
          description: 'Exact replacements. Each item uses oldText/newText; optional replaceAll.',
          items: {
            type: 'object',
            properties: {
              oldText: { type: 'string', description: 'Exact text to find (must be unique unless replaceAll)' },
              newText: {
                type: 'string',
                description: 'Literal replacement text, including any line endings required by Markdown block boundaries',
              },
              replaceAll: {
                type: 'boolean',
                description: 'Replace every occurrence of oldText (default: unique match only)',
              },
            },
            required: ['oldText', 'newText'],
            additionalProperties: false,
          },
        },
      },
      required: ['edits'],
      additionalProperties: false,
    },
    async execute(_id, params) {
      const input = params as Record<string, unknown>;
      const file = getStringField(input, 'file');
      const notePath = getStringField(input, 'path');
      if (!file && !notePath) {
        throw new Error('Invalid edit input: path or file must be a string.');
      }
      const editsInput = Array.isArray(input.edits) ? input.edits : [];
      const first = editsInput[0] as Record<string, unknown> | undefined;
      if (!first) {
        throw new Error('Invalid edit input: edits must contain at least one { oldText, newText } item.');
      }
      const oldText = requireStringParam(first.oldText, 'oldText');
      const newText = requireStringParam(first.newText, 'newText');
      const result = await vault.editNote({
        file,
        path: notePath,
        old_string: oldText,
        new_string: newText,
        replace_all: Boolean(first.replaceAll),
      });
      const label = result.replacements === 1 ? 'replacement' : 'replacements';
      return textResult(`Edited ${result.path} (${result.replacements} ${label})`, {
        path: result.path,
        filePath: result.path,
        structuredPatch: buildSubstringPatchHunks(oldText, newText),
        replacements: result.replacements,
      });
    },
  };
}

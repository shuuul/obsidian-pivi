import {
  textResult,
  TOOL_OBSIDIAN_WRITE,
  type ToolSpec,
} from '@pivi/agent/tools';

import type { ObsidianToolDeps } from './deps';

type WriteNoteMode = 'create' | 'overwrite' | 'append' | 'prepend';

function getStringField(input: Record<string, unknown>, key: string): string | undefined {
  const value = input[key];
  return typeof value === 'string' ? value : undefined;
}

function getWriteMode(value: unknown): WriteNoteMode | undefined {
  return value === 'create' || value === 'overwrite' || value === 'append' || value === 'prepend'
    ? value
    : undefined;
}

export function createWriteNoteTool(deps: ObsidianToolDeps): ToolSpec {
  const { vault } = deps;
  return {
    name: TOOL_OBSIDIAN_WRITE,
    label: 'Write note',
    description: 'Create, overwrite, append, or prepend note content via vault API. path= or file= required for create/overwrite. mode defaults to overwrite.',
    promptUsage: {
      summary: 'Write note content. Omit `mode` to overwrite. Keep `append`/`prepend`/`create`. `create` still needs `overwrite: true` to clobber an existing file.',
      parameters: '`path` or `file`, `content`, optional `mode` (overwrite|append|prepend|create, default overwrite), optional `overwrite` for create.',
    },
    parameters: {
      type: 'object',
      properties: {
        file: { type: 'string' },
        path: { type: 'string' },
        content: { type: 'string', description: 'Content to write' },
        mode: {
          type: 'string',
          enum: ['create', 'overwrite', 'append', 'prepend'],
          description: 'Write mode; omit to overwrite',
        },
        overwrite: { type: 'boolean', description: 'Allow overwrite when mode=create' },
      },
      required: ['content'],
      additionalProperties: false,
    },
    async execute(_id, params) {
      const input = params as Record<string, unknown>;
      const content = getStringField(input, 'content');
      const mode = getWriteMode(input.mode) ?? 'overwrite';
      if (content === undefined) {
        throw new Error('Invalid write input: content is required.');
      }
      const result = await vault.writeNote({
        file: getStringField(input, 'file'),
        path: getStringField(input, 'path'),
        content,
        mode,
        overwrite: Boolean(input.overwrite),
      });
      return textResult(`Wrote ${result.path}`, result);
    },
  };
}

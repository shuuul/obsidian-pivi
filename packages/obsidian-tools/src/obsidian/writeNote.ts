import {
  textResult,
  TOOL_OBSIDIAN_WRITE,
  type ToolSpec,
} from '@pivi/pivi-agent-core/tools';

import { requireApproval } from './approval';
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
  const { vault, approve } = deps;
  return {
    name: TOOL_OBSIDIAN_WRITE,
    label: 'Write note',
    description: 'Create, overwrite, append, or prepend note content via vault API. path= or file= required for create/overwrite.',
    parameters: {
      type: 'object',
      properties: {
        file: { type: 'string' },
        path: { type: 'string' },
        content: { type: 'string', description: 'Content to write' },
        mode: {
          type: 'string',
          enum: ['create', 'overwrite', 'append', 'prepend'],
          description: 'Write mode',
        },
        overwrite: { type: 'boolean', description: 'Allow overwrite when mode=create' },
      },
      required: ['content', 'mode'],
      additionalProperties: false,
    },
    async execute(_id, params) {
      const input = params as Record<string, unknown>;
      await requireApproval(approve, TOOL_OBSIDIAN_WRITE, input);
      const content = getStringField(input, 'content');
      const mode = getWriteMode(input.mode);
      if (content === undefined || !mode) {
        throw new Error('Invalid write note input: content and mode are required strings.');
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

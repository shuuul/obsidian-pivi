import type { AgentTool } from '@earendil-works/pi-agent-core';

import { TOOL_OBSIDIAN_WRITE } from '../../../core/tools/obsidianToolNames';
import { textResult } from '../toolResult';
import { requireApproval } from './approval';
import type { ObsidianToolDeps } from './deps';

export function createWriteNoteTool(deps: ObsidianToolDeps): AgentTool {
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
      const result = await vault.writeNote({
        file: input.file as string | undefined,
        path: input.path as string | undefined,
        content: String(input.content ?? ''),
        mode: input.mode as 'create' | 'overwrite' | 'append' | 'prepend',
        overwrite: Boolean(input.overwrite),
      });
      return textResult(`Wrote ${result.path}`, result);
    },
  };
}

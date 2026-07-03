import {
  textResult,
  TOOL_OBSIDIAN_ATTACHMENT,
  type ToolSpec,
} from '@pivi/pivi-agent-core/tools';

import type { ObsidianToolDeps } from './deps';

function getStringField(input: Record<string, unknown>, key: string): string | undefined {
  const value = input[key];
  return typeof value === 'string' ? value : undefined;
}

export function createAttachmentTool(deps: ObsidianToolDeps): ToolSpec {
  const { vault } = deps;
  return {
    name: TOOL_OBSIDIAN_ATTACHMENT,
    label: 'Attachment info',
    description: 'Resolve attachment metadata/resource URL for an existing vault file, or ask Obsidian for an available attachment save path.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Existing vault-relative attachment path' },
        filename: { type: 'string', description: 'Attachment filename to place according to Obsidian settings' },
        sourcePath: { type: 'string', description: 'Optional source note path for attachment placement rules' },
      },
      additionalProperties: false,
    },
    async execute(_id, params) {
      const input = params as Record<string, unknown>;
      const path = getStringField(input, 'path');
      const filename = getStringField(input, 'filename');
      if (!path && !filename) {
        throw new Error('Invalid attachment input: path or filename must be a string.');
      }
      const result = await vault.getAttachmentInfo({
        path,
        filename,
        sourcePath: getStringField(input, 'sourcePath'),
      });
      return textResult(JSON.stringify(result, null, 2), { ...result });
    },
  };
}

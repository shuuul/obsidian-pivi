import {
  textResult,
  TOOL_OBSIDIAN_LIST,
  type ToolSpec,
} from '@pivi/tools';

import type { ObsidianToolDeps } from './deps';

function getStringField(input: Record<string, unknown>, key: string): string | undefined {
  const value = input[key];
  return typeof value === 'string' ? value : undefined;
}

export function createListPathTool(deps: ObsidianToolDeps): ToolSpec {
  const { vault } = deps;
  return {
    name: TOOL_OBSIDIAN_LIST,
    label: 'List folder',
    description: 'List direct children of a vault folder, including files, folders, and attachments. Use path="" for vault root.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Vault-relative folder path; empty or omitted means root' },
      },
      additionalProperties: false,
    },
    async execute(_id, params) {
      const input = params as Record<string, unknown>;
      const result = await Promise.resolve(vault.listPath(getStringField(input, 'path') ?? ''));
      return textResult(JSON.stringify(result, null, 2), { count: result.length });
    },
  };
}

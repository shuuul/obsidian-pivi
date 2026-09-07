import {
  textResult,
  TOOL_OBSIDIAN_OPEN,
  type ToolSpec,
} from '@pivi/agent/tools';

import type { ObsidianToolDeps } from './deps';

type OpenTarget = false | 'tab' | 'split' | 'window';

function getStringField(input: Record<string, unknown>, key: string): string | undefined {
  const value = input[key];
  return typeof value === 'string' ? value : undefined;
}

function getOpenTarget(input: Record<string, unknown>): OpenTarget {
  if (input.newtab === true) {
    return 'tab';
  }
  const value = input.target;
  return value === 'tab' || value === 'split' || value === 'window' ? value : false;
}

export function createOpenPathTool(deps: ObsidianToolDeps): ToolSpec {
  const { vault } = deps;
  return {
    name: TOOL_OBSIDIAN_OPEN,
    label: 'Open note',
    description: 'Open a vault file in the Obsidian workspace. This changes UI focus but does not mutate files.',
    parameters: {
      type: 'object',
      properties: {
        file: { type: 'string', description: 'Wikilink-style note name' },
        path: { type: 'string', description: 'Vault-relative file path to open' },
        target: { type: 'string', enum: ['current', 'tab', 'split', 'window'] },
        newtab: { type: 'boolean', description: 'Open in a new tab (same as target=tab)' },
      },
      additionalProperties: false,
    },
    async execute(_id, params) {
      const input = params as Record<string, unknown>;
      if (input.path !== undefined && typeof input.path !== 'string') {
        throw new Error('Invalid open input: path must be a string.');
      }
      if (input.file !== undefined && typeof input.file !== 'string') {
        throw new Error('Invalid open input: file must be a string.');
      }
      const path = getStringField(input, 'path');
      const file = getStringField(input, 'file');
      if (!path && !file) {
        throw new Error('Invalid open input: file or path is required.');
      }
      const resolved = vault.resolveFile(file, path);
      if (!resolved) {
        throw new Error('File not found.');
      }
      const result = await vault.openPath(resolved.path, getOpenTarget(input));
      return textResult(`Opened ${result.path}`, { ...result });
    },
  };
}

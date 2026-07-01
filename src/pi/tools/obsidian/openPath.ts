import type { AgentTool } from '@earendil-works/pi-agent-core';

import { TOOL_OBSIDIAN_OPEN } from '../../../pi/tools/obsidianToolNames';
import { textResult } from '../toolResult';
import type { ObsidianToolDeps } from './deps';

type OpenTarget = false | 'tab' | 'split' | 'window';

function getStringField(input: Record<string, unknown>, key: string): string | undefined {
  const value = input[key];
  return typeof value === 'string' ? value : undefined;
}

function getOpenTarget(value: unknown): OpenTarget {
  return value === 'tab' || value === 'split' || value === 'window' ? value : false;
}

export function createOpenPathTool(deps: ObsidianToolDeps): AgentTool {
  const { vault } = deps;
  return {
    name: TOOL_OBSIDIAN_OPEN,
    label: 'Open note',
    description: 'Open a vault file in the Obsidian workspace. This changes UI focus but does not mutate files.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Vault-relative file path to open' },
        target: { type: 'string', enum: ['current', 'tab', 'split', 'window'] },
      },
      required: ['path'],
      additionalProperties: false,
    },
    async execute(_id, params) {
      const input = params as Record<string, unknown>;
      const path = getStringField(input, 'path');
      if (!path) {
        throw new Error('Invalid open input: path must be a string.');
      }
      const result = await vault.openPath(path, getOpenTarget(input.target));
      return textResult(`Opened ${result.path}`, { ...result });
    },
  };
}

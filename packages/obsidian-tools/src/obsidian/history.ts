import {
  textResult,
  TOOL_OBSIDIAN_HISTORY,
  type ToolSpec,
} from '@pivi/pivi-agent-core/tools';

import type { ObsidianToolDeps } from './deps';

type HistoryAction = 'files' | 'list' | 'read' | 'restore';

function getHistoryAction(value: unknown): HistoryAction | undefined {
  return value === 'files' || value === 'list' || value === 'read' || value === 'restore'
    ? value
    : undefined;
}

function getStringField(input: Record<string, unknown>, key: string): string | undefined {
  const value = input[key];
  return typeof value === 'string' ? value : undefined;
}

function getVersionField(input: Record<string, unknown>): number | undefined {
  const value = input.version;
  return typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value) && value > 0
    ? value
    : undefined;
}

function requirePath(input: Record<string, unknown>): string {
  const path = getStringField(input, 'path')?.trim();
  if (!path) {
    throw new Error('path is required.');
  }
  return path;
}

function requireVersion(input: Record<string, unknown>): number {
  const version = getVersionField(input);
  if (version === undefined) {
    throw new Error('version is required for read and restore.');
  }
  return version;
}

export function createHistoryTool(deps: ObsidianToolDeps): ToolSpec {
  const { cli, vaultName } = deps;
  return {
    name: TOOL_OBSIDIAN_HISTORY,
    label: 'History',
    description: 'List, read, or restore Obsidian file history versions through the Obsidian CLI.',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['files', 'list', 'read', 'restore'],
          description: 'History action to run.',
        },
        path: {
          type: 'string',
          description: 'Vault-relative path. Required for list, read, and restore.',
        },
        version: {
          type: 'number',
          description: 'Integer history version number. Required for read and restore.',
        },
      },
      required: ['action'],
      additionalProperties: false,
    },
    async execute(_id, params) {
      const input = params as Record<string, unknown>;
      const action = getHistoryAction(input.action);
      if (!action) {
        throw new Error('Invalid history action.');
      }

      if (action === 'files') {
        const output = await cli.run({ vaultName, args: ['history:list'] });
        return textResult(output, { action });
      }

      const path = requirePath(input);
      if (action === 'list') {
        const output = await cli.run({ vaultName, args: ['history', `path=${path}`] });
        return textResult(output, { action, path });
      }

      const version = requireVersion(input);
      if (action === 'read') {
        const output = await cli.run({ vaultName, args: ['history:read', `path=${path}`, `version=${version}`] });
        return textResult(output, { action, path, version });
      }

      await cli.run({ vaultName, args: ['history:restore', `path=${path}`, `version=${version}`] });
      return textResult(`Restored ${path} from history version ${version}.`, { action, path, version });
    },
  };
}

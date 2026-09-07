import {
  textResult,
  TOOL_OBSIDIAN_HISTORY,
  type ToolSpec,
} from '@pivi/agent/tools';
import { requireAgentVaultMutationPath } from '@pivi/obsidian-host/path';

import { capCliToolOutput } from './cliOutput';
import type { ObsidianToolDeps } from './deps';

type HistoryAction = 'files' | 'list' | 'read' | 'restore' | 'diff';
type HistoryFilter = 'local' | 'sync';

function getHistoryAction(value: unknown): HistoryAction | undefined {
  return value === 'files' || value === 'list' || value === 'read' || value === 'restore' || value === 'diff'
    ? value
    : undefined;
}

function getHistoryFilter(value: unknown): HistoryFilter | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === 'local' || value === 'sync') {
    return value;
  }
  throw new Error('Invalid history filter: must be local or sync.');
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

function pushTargetArgs(args: string[], input: Record<string, unknown>): void {
  const file = getStringField(input, 'file')?.trim();
  const path = getStringField(input, 'path')?.trim();
  if (file) {
    args.push(`file=${file}`);
  }
  if (path) {
    args.push(`path=${path}`);
  }
}

function requireHistoryTarget(input: Record<string, unknown>): { file?: string; path?: string } {
  const file = getStringField(input, 'file')?.trim();
  const path = getStringField(input, 'path')?.trim();
  if (!file && !path) {
    throw new Error('file or path is required.');
  }
  return { file, path };
}

function requireVersion(input: Record<string, unknown>): number {
  const version = getVersionField(input);
  if (version === undefined) {
    throw new Error('version is required for read and restore.');
  }
  return version;
}

export function createHistoryTool(deps: ObsidianToolDeps): ToolSpec {
  const { cli, vaultName, vaultPath } = deps;
  return {
    name: TOOL_OBSIDIAN_HISTORY,
    label: 'History',
    description: 'List, read, or restore Obsidian file history versions through the Obsidian CLI.',
    promptUsage: {
      summary: 'Recover changed, overwritten, or deleted notes from Obsidian history: discover with files when the path is unknown, list versions for a known path, inspect with read when practical, then restore in place. `diff` compares File Recovery or Sync versions.',
      parameters: '`action` required files|list|read|restore|diff; `file` or `path` required except for files; `version` required for read and restore; `from`/`to`/`filter` for diff.',
    },
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['files', 'list', 'read', 'restore', 'diff'],
          description: 'History action to run.',
        },
        file: {
          type: 'string',
          description: 'Wikilink-style note name. Use with list, read, restore, or diff.',
        },
        path: {
          type: 'string',
          description: 'Vault-relative path. Required for list, read, restore, and diff unless file is set.',
        },
        version: {
          type: 'number',
          description: 'Integer history version number. Required for read and restore.',
        },
        from: {
          type: 'number',
          description: 'Diff: version number to compare from (newest is 1).',
        },
        to: {
          type: 'number',
          description: 'Diff: version number to compare to.',
        },
        filter: {
          type: 'string',
          enum: ['local', 'sync'],
          description: 'Diff: limit versions to File Recovery or Sync.',
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
        return textResult(capCliToolOutput(output), { action });
      }

      if (action === 'diff') {
        const target = requireHistoryTarget(input);
        const args = ['diff'];
        pushTargetArgs(args, input);
        const from = getVersionField({ version: input.from });
        const to = getVersionField({ version: input.to });
        const filter = getHistoryFilter(input.filter);
        if (from !== undefined) {
          args.push(`from=${from}`);
        }
        if (to !== undefined) {
          args.push(`to=${to}`);
        }
        if (filter) {
          args.push(`filter=${filter}`);
        }
        const output = await cli.run({ vaultName, args });
        return textResult(capCliToolOutput(output), { action, ...target, from, to, filter });
      }

      const target = requireHistoryTarget(input);
      if (action === 'list') {
        const args = ['history'];
        pushTargetArgs(args, input);
        const output = await cli.run({ vaultName, args });
        return textResult(capCliToolOutput(output), { action, ...target });
      }

      const version = requireVersion(input);
      if (action === 'read') {
        const args = ['history:read'];
        pushTargetArgs(args, input);
        args.push(`version=${version}`);
        const output = await cli.run({ vaultName, args });
        return textResult(capCliToolOutput(output), { action, ...target, version });
      }

      const restorePath = target.path
        ?? deps.vault.resolveFile(target.file, undefined)?.path
        ?? target.file;
      if (!restorePath) {
        throw new Error('file or path is required.');
      }
      const mutationPath = requireAgentVaultMutationPath(restorePath, vaultPath);
      await deps.vault.captureSnapshotBeforeCliMutation(mutationPath);
      await cli.run({
        vaultName,
        args: ['history:restore', `path=${mutationPath}`, `version=${version}`],
      });
      return textResult(
        `Restored ${mutationPath} from history version ${version}.`,
        { action, path: mutationPath, version },
      );
    },
  };
}

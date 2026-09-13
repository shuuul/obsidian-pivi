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

interface HistoryListEntry {
  readonly index: number;
  readonly timestamp: string;
  readonly size: string;
}

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

/** Parse the CLI `history` table: rows of `index\ttimestamp\tsize` below a path header line. */
function parseHistoryList(output: string): HistoryListEntry[] {
  const entries: HistoryListEntry[] = [];
  for (const line of output.split('\n')) {
    const match = /^(\d+)\t([^\t]*)\t([^\t]*)$/.exec(line.trimEnd());
    if (!match) {
      continue;
    }
    entries.push({ index: Number(match[1]), timestamp: match[2] ?? '', size: match[3] ?? '' });
  }
  return entries;
}

async function listHistoryEntries(
  cli: ObsidianToolDeps['cli'],
  vaultName: string,
  mutationPath: string,
): Promise<HistoryListEntry[]> {
  const output = await cli.run({ vaultName, args: ['history', `path=${mutationPath}`] });
  return parseHistoryList(output);
}

/**
 * The pre-restore File Recovery snapshot prepends versions, shifting every
 * number the CLI is about to resolve. Verify the post-snapshot list is exactly
 * the pre-snapshot list with `shift` entries prepended, and return that shift.
 * Obsidian versions are prepend-only, so a full positional alignment must hold;
 * anything else means the list changed concurrently and the agent's number no
 * longer refers to a knowable entry.
 */
function requireAlignedPrependShift(before: HistoryListEntry[], after: HistoryListEntry[]): number {
  const shift = after.length - before.length;
  if (shift < 0) {
    throw new Error(
      'Obsidian history versions changed while preparing the restore (versions disappeared). Re-list versions and retry.',
    );
  }
  for (let i = 0; i < before.length; i++) {
    const expected = before[i];
    const actual = after[i + shift];
    if (!expected || !actual || actual.timestamp !== expected.timestamp || actual.size !== expected.size) {
      throw new Error(
        'Obsidian history versions changed while preparing the restore. Re-list versions and retry.',
      );
    }
  }
  return shift;
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

      // Anchor the agent's version number before the host snapshot shifts it:
      // runCliMutation captures a File Recovery snapshot of the destination
      // immediately before this CLI call, and that snapshot becomes the new
      // version 1, so resolving the raw number afterwards would restore a
      // different (newer) entry than the one the agent selected.
      const beforeSnapshot = await listHistoryEntries(cli, vaultName, mutationPath);
      if (beforeSnapshot.length === 0) {
        throw new Error(`No Obsidian history versions exist for ${mutationPath}.`);
      }
      if (version > beforeSnapshot.length) {
        throw new Error(
          `History version ${version} does not exist for ${mutationPath} (${beforeSnapshot.length} versions listed). Re-list versions and retry.`,
        );
      }
      // Deleted destinations have no current state to snapshot, so their
      // numbering cannot shift and the restore-write snapshot below is not
      // guaranteed; the applied-restore verification is for existing files.
      const destinationExists = !!deps.vault.resolveFile(target.file, target.path);

      const { output, resolvedVersion } = await deps.vault.runCliMutation(
        mutationPath,
        async () => {
          const afterSnapshot = await listHistoryEntries(cli, vaultName, mutationPath);
          const shift = requireAlignedPrependShift(beforeSnapshot, afterSnapshot);
          const resolvedVersion = version + shift;
          const restoreOutput = await cli.run({
            vaultName,
            args: ['history:restore', `path=${mutationPath}`, `version=${resolvedVersion}`],
          });
          if (!destinationExists) {
            return { output: restoreOutput, resolvedVersion };
          }
          // The restore write prepends the restored content as a new version.
          // A list that did not grow means the CLI claimed success without
          // applying anything; report that loudly instead of a false success.
          const afterRestore = await listHistoryEntries(cli, vaultName, mutationPath);
          if (afterRestore.length <= afterSnapshot.length) {
            throw new Error(
              `Obsidian reported success but the restore of ${mutationPath} did not apply. Re-list versions and verify the note content before retrying.`,
            );
          }
          // The restored write must carry the selected version's content size;
          // anything else means the wrong content landed on disk.
          const restoredEntry = afterRestore[0];
          const intendedEntry = beforeSnapshot[version - 1];
          if (restoredEntry && intendedEntry && restoredEntry.size !== intendedEntry.size) {
            throw new Error(
              `Obsidian restored content whose size (${restoredEntry.size}) does not match history version ${version} (${intendedEntry.size}). Re-list versions and verify the note content.`,
            );
          }
          return { output: restoreOutput, resolvedVersion };
        },
      );
      return textResult(
        `Restored ${mutationPath} from history version ${version}`
        + (resolvedVersion !== version
          ? ` (resolved to version ${resolvedVersion} after the pre-restore safety snapshot)`
          : '')
        + '.',
        { action, path: mutationPath, version, resolvedVersion, output },
      );
    },
  };
}

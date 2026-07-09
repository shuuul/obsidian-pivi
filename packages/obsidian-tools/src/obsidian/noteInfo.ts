import {
  textResult,
  TOOL_OBSIDIAN_NOTE_INFO,
  type ToolSpec,
} from '@pivi/pivi-agent-core/tools';

import type { ObsidianToolDeps } from './deps';

function getOptionalStringField(input: Record<string, unknown>, key: string, message: string): string | undefined {
  const value = input[key];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'string') {
    throw new Error(message);
  }
  return value;
}

function getPositiveIntegerField(input: Record<string, unknown>, key: string): number | undefined {
  const value = input[key];
  if (value === undefined) { return undefined; }
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw new Error(`${key} must be a positive integer.`);
  }
  return value;
}

export function createNoteInfoTool(deps: ObsidianToolDeps): ToolSpec {
  const { vault, cli, settings, vaultName } = deps;
  const obsidianCliAvailable = deps.obsidianCliAvailable ?? settings.cliEnabled;
  return {
    name: TOOL_OBSIDIAN_NOTE_INFO,
    label: 'Note info',
    description:
      'Note metadata via vault API: path, size, ctime/mtime, tags, outgoing links, frontmatter, '
      + 'word count, character count, and aliases. '
      + 'Also supports action=recent to list recently opened files. '
      + (obsidianCliAvailable
        ? 'CLI fallback is available if API metadata fails.'
        : 'API-only for this turn; no CLI fallback is available.'),
    parameters: {
      type: 'object',
      properties: {
        file: { type: 'string', description: 'Wikilink-style note name.' },
        path: { type: 'string', description: 'Vault-relative path, e.g. folder/note.md.' },
        action: {
          type: 'string',
          enum: ['recent'],
          description: 'action=recent: list recently opened files (file/path ignored).',
        },
        limit: {
          type: 'number',
          description: 'Maximum results for action=recent (default 20).',
        },
      },
      additionalProperties: false,
    },
    async execute(_id, params) {
      const input = params as Record<string, unknown>;
      const action = getOptionalStringField(input, 'action', 'action must be a string.');

      if (action !== undefined && action !== 'recent') {
        throw new Error('Invalid note info action: must be recent.');
      }

      if (action === 'recent') {
        const limit = getPositiveIntegerField(input, 'limit') ?? 20;
        const recents = vault.getRecentFiles(limit);
        return textResult(JSON.stringify({ recent: recents, total: recents.length }, null, 2), {
          action: 'recent',
          total: recents.length,
        });
      }

      const file = getOptionalStringField(input, 'file', 'file or path must be a string.');
      const notePath = getOptionalStringField(input, 'path', 'file or path must be a string.');

      try {
        const info = await vault.getNoteInfo(file, notePath);
        return textResult(JSON.stringify(info, null, 2));
      } catch (apiError) {
        if (!obsidianCliAvailable) {
          throw apiError;
        }
        const args = ['file', 'format=json'];
        if (file) {
          args.push(`file=${file}`);
        }
        if (notePath) {
          args.push(`path=${JSON.stringify(notePath)}`);
        }
        const out = await cli.run({ vaultName, args });
        return textResult(out);
      }
    },
  };
}

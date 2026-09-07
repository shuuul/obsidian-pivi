import {
  textResult,
  TOOL_OBSIDIAN_BOOKMARKS,
  type ToolSpec,
} from '@pivi/agent/tools';

import { capCliToolOutput } from './cliOutput';
import type { ObsidianToolDeps } from './deps';

type BookmarksAction = 'list' | 'add';
const VALID_ACTIONS: readonly BookmarksAction[] = ['list', 'add'];
const VALID_FORMATS = ['json', 'tsv', 'csv'] as const;
type BookmarkFormat = typeof VALID_FORMATS[number];

function getBookmarksAction(value: unknown): BookmarksAction | undefined {
  return typeof value === 'string' && (VALID_ACTIONS as readonly string[]).includes(value)
    ? (value as BookmarksAction)
    : undefined;
}

function getStringField(input: Record<string, unknown>, key: string): string | undefined {
  const value = input[key];
  return typeof value === 'string' ? value : undefined;
}

function getBooleanField(input: Record<string, unknown>, key: string): boolean | undefined {
  const value = input[key];
  return typeof value === 'boolean' ? value : undefined;
}

function getBookmarkFormat(value: unknown): BookmarkFormat {
  if (value === undefined) {
    return 'json';
  }
  if (typeof value === 'string' && (VALID_FORMATS as readonly string[]).includes(value)) {
    return value as BookmarkFormat;
  }
  throw new Error('Invalid bookmarks format: must be json, tsv, or csv.');
}

export function createBookmarksTool(deps: ObsidianToolDeps): ToolSpec {
  const { cli, vault, vaultName } = deps;
  return {
    name: TOOL_OBSIDIAN_BOOKMARKS,
    label: 'Bookmarks',
    description:
      'List Obsidian bookmarks or add a file, folder, search, or URL bookmark. '
      + 'Requires the official Obsidian CLI.',
    promptUsage: {
      summary: 'Inspect or add Bookmarks core-plugin entries. `list` returns bookmarks; `add` creates one bookmark for a file, folder, search query, or URL. Adding a file/folder requires an existing vault path.',
      parameters: '`action` required list|add; list accepts `total`, `verbose`, `format`; add requires one of `file`/`path`, `folder`, `search`, or `url`, plus optional `subpath` and `title`.',
    },
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['list', 'add'],
          description: 'list: bookmarks. add: create a bookmark.',
        },
        total: { type: 'boolean', description: 'List: return a count instead of rows.' },
        verbose: { type: 'boolean', description: 'List: include bookmark types.' },
        format: { type: 'string', enum: ['json', 'tsv', 'csv'], description: 'List output format (default json).' },
        file: { type: 'string', description: 'File name to bookmark (add).' },
        path: { type: 'string', description: 'Vault-relative file path to bookmark (add).' },
        folder: { type: 'string', description: 'Folder path to bookmark (add).' },
        search: { type: 'string', description: 'Search query to bookmark (add).' },
        url: { type: 'string', description: 'URL to bookmark (add).' },
        subpath: { type: 'string', description: 'Heading or block subpath within a file (add).' },
        title: { type: 'string', description: 'Bookmark title (add).' },
      },
      required: ['action'],
      additionalProperties: false,
    },
    async execute(_id, params) {
      const input = params as Record<string, unknown>;
      const action = getBookmarksAction(input['action']);
      if (!action) {
        throw new Error('Invalid bookmarks action: must be list or add.');
      }

      if (action === 'list') {
        const args = ['bookmarks', `format=${getBookmarkFormat(input['format'])}`];
        if (getBooleanField(input, 'total') === true) {
          args.push('total');
        }
        if (getBooleanField(input, 'verbose') === true) {
          args.push('verbose');
        }
        const out = await cli.run({ vaultName, args });
        return textResult(capCliToolOutput(out), { action });
      }

      const file = getStringField(input, 'file')?.trim();
      const path = getStringField(input, 'path')?.trim();
      const folder = getStringField(input, 'folder')?.trim();
      const search = getStringField(input, 'search')?.trim();
      const url = getStringField(input, 'url')?.trim();
      const targets = [file || path, folder, search, url].filter(Boolean);
      if (targets.length !== 1) {
        throw new Error('add requires exactly one of file/path, folder, search, or url.');
      }

      const args = ['bookmark'];
      if (file || path) {
        const resolved = vault.resolveFile(file, path);
        if (!resolved) {
          throw new Error('File not found.');
        }
        args.push(`file=${resolved.path}`);
      }
      if (folder) {
        args.push(`folder=${folder}`);
      }
      if (search) {
        args.push(`search=${search}`);
      }
      if (url) {
        args.push(`url=${url}`);
      }
      const subpath = getStringField(input, 'subpath')?.trim();
      const title = getStringField(input, 'title')?.trim();
      if (subpath) {
        args.push(`subpath=${subpath}`);
      }
      if (title) {
        args.push(`title=${title}`);
      }
      const out = await cli.run({ vaultName, args });
      return textResult(capCliToolOutput(out) || 'Bookmark added.', { action });
    },
  };
}

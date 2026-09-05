import {
  textResult,
  TOOL_OBSIDIAN_SEARCH,
  type ToolSpec,
} from '@pivi/agent/tools';

import type { ObsidianToolDeps } from './deps';

function getStringField(input: Record<string, unknown>, key: string): string | undefined {
  const value = input[key];
  return typeof value === 'string' ? value : undefined;
}

function getNumberField(input: Record<string, unknown>, key: string): number | undefined {
  const value = input[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function getBooleanField(input: Record<string, unknown>, key: string): boolean | undefined {
  const value = input[key];
  return typeof value === 'boolean' ? value : undefined;
}

function getSearchFormat(input: Record<string, unknown>): 'text' | 'json' | undefined {
  const value = input.format;
  return value === 'text' || value === 'json' ? value : undefined;
}

export function createSearchTool(deps: ObsidianToolDeps): ToolSpec {
  const { vault, cli, settings, vaultName } = deps;
  const obsidianCliAvailable = deps.obsidianCliAvailable ?? settings.cliEnabled;
  return {
    name: TOOL_OBSIDIAN_SEARCH,
    label: 'Search vault',
    description: obsidianCliAvailable
      ? 'Search Markdown note contents with a case-insensitive literal substring, or tag:name. Scope with path to one note or folder; omit path only for a vault-wide search. Not regex and not Obsidian in-app search. Use ls for folder listing. Falls back to CLI on API errors.'
      : 'Search Markdown note contents with a case-insensitive literal substring, or tag:name. Scope with path to one note or folder; omit path only for a vault-wide search. Not regex and not Obsidian in-app search. Use ls for folder listing. No CLI fallback is available.',
    promptUsage: {
      summary: `Case-insensitive literal substring plus optional \`tag:name\`. Pass \`path\` for one Markdown note or a folder; omit \`path\` only when the whole vault must be scanned. Not regex and not Obsidian in-app search. Use search to locate notes and match positions, never as a content-read backdoor: \`context: true\` dumps are not a substitute for reading note bodies. Empty, \`*\`, \`**\`, and \`path:\`-only listing queries error toward \`ls\`.${obsidianCliAvailable ? ' Falls back to CLI on API errors.' : ' No CLI fallback is available.'}`,
      parameters: '`query` required plain substring or tag:name; `path?` one Markdown note or folder; `limit?`; `context?`; `format?` text|json.',
    },
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Plain text substring or tag:name. Not regex. Not * / ** / path: listing.',
        },
        path: { type: 'string', description: 'Limit to one Markdown note or folder. Omit only for a vault-wide search.' },
        limit: { type: 'number' },
        context: { type: 'boolean', description: 'Include ±2 context lines per match (API). CLI fallback uses search:context.' },
        format: { type: 'string', enum: ['text', 'json'] },
      },
      required: ['query'],
      additionalProperties: false,
    },
    async execute(_id, params) {
      const input = params as Record<string, unknown>;
      const query = getStringField(input, 'query');
      if (!query) {
        throw new Error('Invalid search input: query must be a string.');
      }
      const trimmed = query.trim();
      if (
        trimmed === ''
        || trimmed === '*'
        || trimmed === '**'
        || trimmed.toLowerCase().startsWith('path:')
      ) {
        throw new Error('search is for note contents and tags, not folder listing. Use `ls` with `path` instead.');
      }
      const folder = getStringField(input, 'path');
      const limit = getNumberField(input, 'limit');
      const context = getBooleanField(input, 'context');
      const format = getSearchFormat(input);

      try {
        const hits = await vault.searchNotes({
          query,
          path: folder,
          limit,
          context,
        });
        const payload = format === 'text'
          ? hits.map((h) => {
            const loc = h.line ? `${h.path}:${h.line}` : h.path;
            const ctx = h.matches?.length ? `\n${h.matches.join('\n')}` : '';
            return `${loc}${ctx}`;
          }).join('\n---\n')
          : JSON.stringify(hits, null, 2);
        return textResult(payload);
      } catch (apiError) {
        if (!obsidianCliAvailable) {
          throw apiError;
        }
        const sub = context ? 'search:context' : 'search';
        const args = [`${sub}`, `query=${JSON.stringify(query)}`, 'format=json'];
        if (folder) {
          args.push(`path=${JSON.stringify(folder)}`);
        }
        if (limit !== undefined) {
          args.push(`limit=${limit}`);
        }
        if (format === 'text') {
          args[args.length - 1] = 'format=text';
        }
        const out = await cli.run({ vaultName, args });
        return textResult(out);
      }
    },
  };
}

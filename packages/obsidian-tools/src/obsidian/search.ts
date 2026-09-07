import {
  textResult,
  TOOL_OBSIDIAN_SEARCH,
  type ToolSpec,
} from '@pivi/agent/tools';

import type { ObsidianToolDeps } from './deps';

const DEFAULT_SEARCH_LIMIT = 50;
const MAX_SEARCH_LIMIT = 200;
const MAX_SEARCH_RESULT_CHARS = 50_000;
const MAX_CONTEXT_LINE_CHARS = 200;
const SEARCH_PATH_ERROR =
  'search requires a vault-relative path to one Markdown note or a non-root folder. Vault-wide search is not allowed.';

interface SearchHit {
  path: string;
  line?: number;
  matches?: string[];
}

function getStringField(input: Record<string, unknown>, key: string): string | undefined {
  const value = input[key];
  return typeof value === 'string' ? value : undefined;
}

function getIntegerField(input: Record<string, unknown>, key: string): number | undefined {
  const value = input[key];
  return typeof value === 'number' && Number.isInteger(value) ? value : undefined;
}

function getBooleanField(input: Record<string, unknown>, key: string): boolean | undefined {
  const value = input[key];
  return typeof value === 'boolean' ? value : undefined;
}

function getSearchFormat(input: Record<string, unknown>): 'text' | 'json' | undefined {
  const value = input.format;
  return value === 'text' || value === 'json' ? value : undefined;
}

function isVaultRootSearchPath(path: string): boolean {
  return path === '/'
    || path === '.'
    || path === './'
    || path === '.\\'
    || /^\/+$/.test(path);
}

function requireSearchPath(input: Record<string, unknown>): string {
  const raw = input.path;
  if (typeof raw !== 'string') {
    throw new Error(SEARCH_PATH_ERROR);
  }
  const path = raw.trim();
  if (!path || isVaultRootSearchPath(path)) {
    throw new Error(SEARCH_PATH_ERROR);
  }
  return path;
}

function truncateContextLine(line: string): string {
  if (line.length <= MAX_CONTEXT_LINE_CHARS) {
    return line;
  }
  return `${line.slice(0, MAX_CONTEXT_LINE_CHARS)}…`;
}

function capHit(hit: SearchHit): SearchHit {
  if (!hit.matches?.length) {
    return hit;
  }
  return {
    ...hit,
    matches: hit.matches.map(truncateContextLine),
  };
}

function formatTextHits(hits: SearchHit[]): string {
  return hits.map((hit) => {
    const loc = hit.line ? `${hit.path}:${hit.line}` : hit.path;
    const ctx = hit.matches?.length ? `\n${hit.matches.join('\n')}` : '';
    return `${loc}${ctx}`;
  }).join('\n---\n');
}

function serializeSearchPage(
  hits: SearchHit[],
  offset: number,
  requestedLimit: number,
  format: 'text' | 'json',
): { payload: string; returnedCount: number; nextOffset?: number } {
  const capped = hits.map(capHit);
  let page = capped;
  while (page.length > 0) {
    const hasMore = page.length < capped.length || capped.length >= requestedLimit;
    const nextOffset = hasMore ? offset + page.length : undefined;
    const payload = format === 'text'
      ? [
        formatTextHits(page),
        ...(nextOffset !== undefined
          ? [`\n\n[search truncated; continue with offset=${nextOffset}]`]
          : []),
      ].join('')
      : JSON.stringify({
        hits: page,
        offset,
        ...(nextOffset !== undefined ? { nextOffset } : {}),
      }, null, 2);
    if (payload.length <= MAX_SEARCH_RESULT_CHARS) {
      return { payload, returnedCount: page.length, nextOffset };
    }
    if (page.length === 1) {
      throw new Error(
        'One search hit exceeds the safe search output limit. Narrow `path` or omit `context`.',
      );
    }
    page = page.slice(0, Math.ceil(page.length / 2));
  }
  const emptyPayload = format === 'text'
    ? ''
    : JSON.stringify({ hits: [], offset }, null, 2);
  return { payload: emptyPayload, returnedCount: 0 };
}

function capCliOutput(output: string): string {
  if (output.length <= MAX_SEARCH_RESULT_CHARS) {
    return output;
  }
  const marker = `\n\n[search truncated to ${MAX_SEARCH_RESULT_CHARS} characters]`;
  const budget = Math.max(0, MAX_SEARCH_RESULT_CHARS - marker.length);
  return `${output.slice(0, budget)}${marker}`;
}

export function createSearchTool(deps: ObsidianToolDeps): ToolSpec {
  const { vault, cli, settings, vaultName } = deps;
  const obsidianCliAvailable = deps.obsidianCliAvailable ?? settings.cliEnabled;
  return {
    name: TOOL_OBSIDIAN_SEARCH,
    label: 'Search vault',
    description: obsidianCliAvailable
      ? 'Search Markdown note contents with a case-insensitive literal substring, or tag:name. Path is required and must be one Markdown note or a non-root folder. Not regex and not Obsidian in-app search. Use ls for folder listing. Falls back to CLI on API errors.'
      : 'Search Markdown note contents with a case-insensitive literal substring, or tag:name. Path is required and must be one Markdown note or a non-root folder. Not regex and not Obsidian in-app search. Use ls for folder listing. No CLI fallback is available.',
    promptUsage: {
      summary: `Case-insensitive literal substring plus optional \`tag:name\`. \`path\` is required: one Markdown note or a non-root folder. Vault-wide scans (omitted, empty, \`/\`, or vault-root \`path\`) are rejected. Not regex and not Obsidian in-app search. Use search to locate notes and match positions, never as a content-read backdoor: \`context: true\` dumps are not a substitute for reading note bodies. Empty, \`*\`, \`**\`, and \`path:\`-only listing queries error toward \`ls\`.${obsidianCliAvailable ? ' Falls back to CLI on API errors.' : ' No CLI fallback is available.'}`,
      parameters: '`query` required plain substring or tag:name; `path` required Markdown note or non-root folder; `limit?` 1–200, default 50; `offset?` 0-based continuation from `nextOffset`; `context?`; `format?` text|json.',
    },
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Plain text substring or tag:name. Not regex. Not * / ** / path: listing.',
        },
        path: {
          type: 'string',
          description: 'Required. One Markdown note or a non-root folder. Vault-wide search is not allowed.',
        },
        limit: {
          type: 'number',
          minimum: 1,
          maximum: MAX_SEARCH_LIMIT,
          description: 'Maximum hits to return (1-200, default 50)',
        },
        offset: {
          type: 'number',
          minimum: 0,
          description: '0-based hit offset; use the previous response nextOffset to continue',
        },
        context: { type: 'boolean', description: 'Include ±2 truncated context lines per match (API). CLI fallback uses search:context.' },
        format: { type: 'string', enum: ['text', 'json'] },
      },
      required: ['query', 'path'],
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
      const folder = requireSearchPath(input);
      const limit = getIntegerField(input, 'limit') ?? DEFAULT_SEARCH_LIMIT;
      const offset = getIntegerField(input, 'offset') ?? 0;
      const context = getBooleanField(input, 'context');
      const format = getSearchFormat(input) ?? 'json';
      if (offset < 0) {
        throw new Error('Invalid search input: offset must be a non-negative integer.');
      }
      if (limit < 1 || limit > MAX_SEARCH_LIMIT) {
        throw new Error(`Invalid search input: limit must be an integer from 1 to ${MAX_SEARCH_LIMIT}.`);
      }

      try {
        const hits = await vault.searchNotes({
          query,
          path: folder,
          limit,
          offset,
          context,
        }) as SearchHit[];
        const page = serializeSearchPage(hits, offset, limit, format);
        return textResult(page.payload, {
          count: hits.length,
          returnedCount: page.returnedCount,
          offset,
          ...(page.nextOffset !== undefined ? { nextOffset: page.nextOffset } : {}),
        });
      } catch (apiError) {
        if (!obsidianCliAvailable) {
          throw apiError;
        }
        const sub = context ? 'search:context' : 'search';
        const args = [
          `${sub}`,
          `query=${JSON.stringify(query)}`,
          `path=${JSON.stringify(folder)}`,
          `format=${format === 'text' ? 'text' : 'json'}`,
          `limit=${limit}`,
        ];
        const out = await cli.run({ vaultName, args });
        return textResult(capCliOutput(out));
      }
    },
  };
}

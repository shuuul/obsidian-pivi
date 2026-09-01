import {
  textResult,
  TOOL_OBSIDIAN_LIST,
  type ToolSpec,
} from '@pivi/agent/tools';

import type { ObsidianToolDeps } from './deps';

const DEFAULT_LIST_LIMIT = 100;
const MAX_LIST_LIMIT = 200;
const MAX_LIST_RESULT_CHARS = 50_000;

function getStringField(input: Record<string, unknown>, key: string): string | undefined {
  const value = input[key];
  return typeof value === 'string' ? value : undefined;
}

function getIntegerField(input: Record<string, unknown>, key: string): number | undefined {
  const value = input[key];
  return typeof value === 'number' && Number.isInteger(value) ? value : undefined;
}

function buildListPage(entries: unknown[], offset: number, requestedLimit: number): {
  entries: unknown[];
  nextOffset?: number;
  offset: number;
  total: number;
} {
  const total = entries.length;
  let pageEntries = entries.slice(offset, offset + requestedLimit);
  while (pageEntries.length > 1) {
    const nextOffset = offset + pageEntries.length;
    const candidate = {
      entries: pageEntries,
      ...(nextOffset < total ? { nextOffset } : {}),
      offset,
      total,
    };
    if (JSON.stringify(candidate, null, 2).length <= MAX_LIST_RESULT_CHARS) {
      return candidate;
    }
    pageEntries = pageEntries.slice(0, Math.ceil(pageEntries.length / 2));
  }
  const nextOffset = offset + pageEntries.length;
  const candidate = {
    entries: pageEntries,
    ...(nextOffset < total ? { nextOffset } : {}),
    offset,
    total,
  };
  if (JSON.stringify(candidate, null, 2).length > MAX_LIST_RESULT_CHARS) {
    throw new Error('One folder entry exceeds the safe list output limit. Use obsidian_search to locate the specific path instead.');
  }
  return candidate;
}

export function createListPathTool(deps: ObsidianToolDeps): ToolSpec {
  const { vault } = deps;
  return {
    name: TOOL_OBSIDIAN_LIST,
    label: 'List folder',
    description: 'List a bounded page of direct children of a vault folder, including files, folders, and attachments. Use path="" for vault root and nextOffset to continue.',
    promptUsage: {
      summary: 'List a bounded page of direct children of a vault folder, including non-Markdown files, folders, and attachments; prefer this over search query=* for simple folder listing.',
      parameters: '`path?` vault-relative folder (empty means root); `offset?` zero-based continuation from `nextOffset`; `limit?` 1–200, default 100.',
    },
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Vault-relative folder path; empty or omitted means root' },
        offset: { type: 'number', minimum: 0, description: 'Zero-based item offset; use the previous response nextOffset to continue' },
        limit: { type: 'number', minimum: 1, maximum: MAX_LIST_LIMIT, description: 'Maximum entries to return (1-200, default 100)' },
      },
      additionalProperties: false,
    },
    async execute(_id, params) {
      const input = params as Record<string, unknown>;
      const result = await Promise.resolve(vault.listPath(getStringField(input, 'path') ?? ''));
      const offset = getIntegerField(input, 'offset') ?? 0;
      const limit = getIntegerField(input, 'limit') ?? DEFAULT_LIST_LIMIT;
      if (offset < 0) {
        throw new Error('Invalid list input: offset must be a non-negative integer.');
      }
      if (limit < 1 || limit > MAX_LIST_LIMIT) {
        throw new Error(`Invalid list input: limit must be an integer from 1 to ${MAX_LIST_LIMIT}.`);
      }
      const page = buildListPage(result, offset, limit);
      return textResult(JSON.stringify(page, null, 2), {
        count: result.length,
        returnedCount: page.entries.length,
        offset: page.offset,
        ...(page.nextOffset !== undefined ? { nextOffset: page.nextOffset } : {}),
      });
    },
  };
}

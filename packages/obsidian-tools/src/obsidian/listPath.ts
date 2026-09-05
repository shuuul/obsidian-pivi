import * as path from 'node:path';

import {
  textResult,
  TOOL_OBSIDIAN_LIST,
  type ToolSpec,
} from '@pivi/agent/tools';

import { CAPABILITY_TOOL_NAMES, ensureExternalDirectoryAccess } from '../capabilityApprovalGate';
import type { ObsidianToolDeps } from './deps';
import { resolveUnmanagedAbsolutePath } from './unmanagedVaultPath';

const DEFAULT_LIST_LIMIT = 50;
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
    throw new Error('One folder entry exceeds the safe list output limit. Use `search` to locate the specific path instead.');
  }
  return candidate;
}

export function createListPathTool(deps: ObsidianToolDeps): ToolSpec {
  const { vault } = deps;
  return {
    name: TOOL_OBSIDIAN_LIST,
    label: 'List folder',
    description: 'List a bounded page of direct children of a folder. Vault-indexed folders use the vault API; unindexed vault folders such as `.pivi/` and absolute paths use the filesystem. Optionally filter direct-child names with a case-insensitive query. offset is a 0-based entry index, not a line number.',
    promptUsage: {
      summary: 'List a bounded page of direct children of a folder, including non-Markdown files. `offset` is a 0-based entry index (not a `read` line number). Prefer this over `search` for folder listing.',
      parameters: '`path?` vault-relative, unindexed, or absolute folder (empty means vault root); `query?` case-insensitive substring filter over direct-child names only; `offset?` 0-based continuation from `nextOffset`; `limit?` 1–200, default 50.',
    },
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Vault-relative, unindexed, or absolute folder path; empty or omitted means vault root' },
        query: { type: 'string', description: 'Optional case-insensitive substring filter over direct-child names; use search for note contents' },
        offset: { type: 'number', minimum: 0, description: '0-based entry offset, not a line number; use the previous response nextOffset to continue' },
        limit: { type: 'number', minimum: 1, maximum: MAX_LIST_LIMIT, description: 'Maximum entries to return (1-200, default 50)' },
      },
      additionalProperties: false,
    },
    async execute(_id, params) {
      const input = params as Record<string, unknown>;
      const requestedPath = getStringField(input, 'path') ?? '';
      const listAbsolute = async (absolutePath: string) => {
        const externalFiles = await ensureExternalDirectoryAccess(
          deps,
          absolutePath,
          true,
          CAPABILITY_TOOL_NAMES.listExternal,
        );
        return externalFiles.listPath(absolutePath);
      };
      let result;
      if (requestedPath && path.isAbsolute(requestedPath)) {
        result = await listAbsolute(requestedPath);
      } else {
        try {
          result = await Promise.resolve(vault.listPath(requestedPath));
        } catch (error) {
          const absolute = resolveUnmanagedAbsolutePath(deps, { path: requestedPath }, error, 'directory');
          if (!absolute) {
            throw error;
          }
          result = await listAbsolute(absolute);
        }
      }
      const query = getStringField(input, 'query')?.trim().toLowerCase();
      const filtered = query
        ? result.filter(entry => entry.name.toLowerCase().includes(query))
        : result;
      const offset = getIntegerField(input, 'offset') ?? 0;
      const limit = getIntegerField(input, 'limit') ?? DEFAULT_LIST_LIMIT;
      if (offset < 0) {
        throw new Error('Invalid list input: offset must be a non-negative integer.');
      }
      if (limit < 1 || limit > MAX_LIST_LIMIT) {
        throw new Error(`Invalid list input: limit must be an integer from 1 to ${MAX_LIST_LIMIT}.`);
      }
      const page = buildListPage(filtered, offset, limit);
      return textResult(JSON.stringify(page, null, 2), {
        count: filtered.length,
        returnedCount: page.entries.length,
        offset: page.offset,
        ...(query ? { query } : {}),
        ...(page.nextOffset !== undefined ? { nextOffset: page.nextOffset } : {}),
      });
    },
  };
}

import { type App, getAllTags, TFile, TFolder } from 'obsidian';

import { normalizePathForVault } from './path';
import type { VaultSearchHit } from './vaultApiTypes';

export interface VaultSearchParams {
  query: string;
  path: string;
  limit?: number;
  offset?: number;
  context?: boolean;
  caseSensitive?: boolean;
}

interface VaultSearchPlan {
  limit: number;
  offset: number;
  /** Empty when only the tag filter applies. */
  needle: string;
  tagFilter: string | null;
  scopePath: string;
}

const LISTING_QUERY_ERROR = 'search is for note contents and tags, not folder listing. Use `ls` with `path` instead.';
const VAULT_WIDE_SCOPE_ERROR = 'search requires a vault-relative path to one Markdown note or a non-root folder. Vault-wide search is not allowed.';

function isVaultRootScope(requestedPath: string): boolean {
  return !requestedPath
    || requestedPath === '/'
    || requestedPath === '.'
    || requestedPath === './'
    || requestedPath === '.\\'
    || /^\/+$/.test(requestedPath);
}

/** Validates search input and rejects listing-style or vault-wide queries before any file is read. */
function planVaultSearch(params: VaultSearchParams): VaultSearchPlan {
  const limit = params.limit ?? 50;
  const offset = params.offset ?? 0;
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
    throw new Error('Invalid search input: limit must be an integer from 1 to 200.');
  }
  if (!Number.isInteger(offset) || offset < 0) {
    throw new Error('Invalid search input: offset must be a non-negative integer.');
  }
  let textQuery = params.query.trim();
  let tagFilter: string | null = null;

  if (textQuery.startsWith('tag:')) {
    tagFilter = textQuery.slice(4).trim().replace(/^#/, '');
    textQuery = '';
  } else if (textQuery.startsWith('path:')) {
    throw new Error(LISTING_QUERY_ERROR);
  }

  const listAllInScope = textQuery === '*'
    || textQuery === ''
    || textQuery === '**';
  if (listAllInScope && !tagFilter) {
    throw new Error(LISTING_QUERY_ERROR);
  }

  const requestedPath = params.path?.trim() ?? '';
  if (isVaultRootScope(requestedPath)) {
    throw new Error(VAULT_WIDE_SCOPE_ERROR);
  }
  return {
    limit,
    offset,
    needle: params.caseSensitive ? textQuery : textQuery.toLowerCase(),
    tagFilter,
    scopePath: requestedPath.replace(/\/+$/, ''),
  };
}

function resolveSearchFiles(app: App, vaultPath: string | null, scopePath: string): TFile[] {
  const normalized = normalizePathForVault(scopePath, vaultPath);
  if (!normalized) {
    throw new Error(`Search path not found: ${scopePath}`);
  }
  const resolved = app.vault.getAbstractFileByPath(normalized);
  if (resolved instanceof TFile) {
    if (resolved.extension !== 'md') {
      throw new Error(`search only reads Markdown notes. Use \`read\` for ${resolved.path}.`);
    }
    return [resolved];
  }
  if (resolved instanceof TFolder) {
    if (!resolved.path) {
      throw new Error(VAULT_WIDE_SCOPE_ERROR);
    }
    const prefix = `${resolved.path}/`;
    return app.vault.getMarkdownFiles().filter((file) => file.path.startsWith(prefix));
  }
  throw new Error(`Search path not found: ${scopePath}`);
}

function hasTag(app: App, file: TFile, tagFilter: string): boolean {
  const cache = app.metadataCache.getFileCache(file);
  const tags = cache ? getAllTags(cache) : null;
  return tags?.some((t) => t === tagFilter || t === `#${tagFilter}`) ?? false;
}

/** In-process vault search (no CLI). Literal substring plus tag:. Listing queries error toward `ls`. */
export async function searchVaultNotes(
  app: App,
  vaultPath: string | null,
  params: VaultSearchParams,
): Promise<VaultSearchHit[]> {
  const { limit, offset, needle, tagFilter, scopePath } = planVaultSearch(params);
  const hits: VaultSearchHit[] = [];
  const files = resolveSearchFiles(app, vaultPath, scopePath);
  let skipped = 0;

  const takeHit = (hit: VaultSearchHit): boolean => {
    if (skipped < offset) {
      skipped += 1;
      return false;
    }
    hits.push(hit);
    return hits.length >= limit;
  };

  for (const file of files) {
    if (tagFilter && !hasTag(app, file, tagFilter)) {
      continue;
    }

    if (!needle) {
      if (takeHit({ path: file.path })) {
        break;
      }
      continue;
    }

    const content = await app.vault.cachedRead(file);
    const lines = content.split('\n');
    for (const [lineIndex, line] of lines.entries()) {
      const searchableLine = params.caseSensitive ? line : line.toLowerCase();
      if (!searchableLine.includes(needle)) {
        continue;
      }
      const hit: VaultSearchHit = { path: file.path, line: lineIndex + 1 };
      if (params.context) {
        const start = Math.max(0, lineIndex - 2);
        const end = Math.min(lines.length, lineIndex + 3);
        hit.matches = lines.slice(start, end);
      }
      if (takeHit(hit)) {
        return hits;
      }
    }
  }

  return hits;
}

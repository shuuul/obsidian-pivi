import {
  type App,
  type BasesConfigFile,
  type BasesConfigFileView,
  type CachedMetadata,
  getAllTags,
  parseFrontMatterAliases,
  parseYaml,
  type TAbstractFile,
  TFile,
  TFolder,
} from 'obsidian';

import { normalizePathForVault } from './path';
import type {
  VaultAliasEntry,
  VaultAttachmentInfo,
  VaultBaseFile,
  VaultBaseView,
  VaultGraphResult,
  VaultLinkEntry,
  VaultNoteInfo,
  VaultPathEntry,
  VaultPropertyIndexEntry,
  VaultRecentFile,
  VaultTagEntry,
} from './vaultApiTypes';

/** Read-only metadata-cache queries: tags, properties, aliases, links, graph analysis, recent files, and Bases. */

function outgoingLinkPaths(app: App, file: TFile, cache: CachedMetadata | null): string[] {
  const paths = new Set<string>();
  for (const link of cache?.links ?? []) {
    const dest = app.metadataCache.getFirstLinkpathDest(link.link, file.path);
    paths.add(dest?.path ?? link.link);
  }
  return [...paths];
}

export async function describeNote(app: App, file: TFile): Promise<VaultNoteInfo> {
  const cache = app.metadataCache.getFileCache(file);
  const content = await app.vault.cachedRead(file);
  const wordCount = content.trim().split(/\s+/).filter(Boolean).length;
  return {
    path: file.path,
    basename: file.basename,
    extension: file.extension,
    size: file.stat.size,
    ctime: file.stat.ctime,
    mtime: file.stat.mtime,
    tags: cache ? (getAllTags(cache) ?? []) : [],
    links: outgoingLinkPaths(app, file, cache),
    frontmatter: cache?.frontmatter ?? null,
    wordCount,
    characterCount: content.length,
    aliases: parseFrontMatterAliases(cache?.frontmatter ?? null) ?? [],
  };
}

/** Link, resource, and size details for an existing attachment file. */
export function describeAttachment(
  app: App,
  file: TFile,
  sourcePath: string | undefined,
): Required<Pick<VaultAttachmentInfo, 'path' | 'markdown' | 'resourcePath' | 'size' | 'extension'>> {
  return {
    path: file.path,
    markdown: app.fileManager.generateMarkdownLink(file, sourcePath ?? ''),
    resourcePath: app.vault.getResourcePath(file),
    size: file.stat.size,
    extension: file.extension,
  };
}

export function listFolderEntries(folder: TFolder): VaultPathEntry[] {
  return folder.children.map((child) => {
    if (child instanceof TFolder) {
      return { path: child.path, kind: 'folder', name: child.name };
    }
    if (!(child instanceof TFile)) {
      throw new Error(`Unsupported vault entry: ${child.path}`);
    }
    return {
      path: child.path,
      kind: 'file',
      name: child.name,
      extension: child.extension,
      size: child.stat.size,
    };
  });
}

export function collectOutgoingLinks(app: App, file: TFile): VaultLinkEntry[] {
  const cache = app.metadataCache.getFileCache(file);
  const links: VaultLinkEntry[] = [];
  const seen = new Map<string, VaultLinkEntry>();

  for (const link of cache?.links ?? []) {
    const dest = app.metadataCache.getFirstLinkpathDest(link.link, file.path);
    const destPath = dest?.path ?? link.link;
    const existing = seen.get(destPath);
    if (existing) {
      existing.count += 1;
    } else {
      const entry: VaultLinkEntry = {
        path: destPath,
        count: 1,
        ...(link.displayText ? { display: link.displayText } : {}),
      };
      seen.set(destPath, entry);
      links.push(entry);
    }
  }
  return links;
}

export function collectBacklinks(app: App, targetPath: string): VaultLinkEntry[] {
  const links: VaultLinkEntry[] = [];
  for (const [sourcePath, destinations] of Object.entries(app.metadataCache.resolvedLinks)) {
    const count = destinations[targetPath];
    if (count) {
      links.push({ path: sourcePath, count });
    }
  }
  return links.sort((a, b) => a.path.localeCompare(b.path));
}

export function collectTags(app: App, files: readonly TFile[], sort: 'name' | 'count'): VaultTagEntry[] {
  const counts = new Map<string, number>();
  for (const file of files) {
    const cache = app.metadataCache.getFileCache(file);
    const tags = cache ? getAllTags(cache) : null;
    if (!tags) { continue; }
    for (const tag of tags) {
      const name = tag.startsWith('#') ? tag.slice(1) : tag;
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
  }
  const entries: VaultTagEntry[] = [...counts.entries()].map(([name, count]) => ({ name, count }));
  entries.sort((a, b) =>
    sort === 'count' ? b.count - a.count || a.name.localeCompare(b.name) : a.name.localeCompare(b.name),
  );
  return entries;
}

export function getTagInfo(app: App, tag: string, verbose?: boolean): { name: string; count: number; files?: string[] } {
  const normalized = tag.replace(/^#/, '').trim();
  let count = 0;
  const files: string[] = [];
  for (const file of app.vault.getMarkdownFiles()) {
    const cache = app.metadataCache.getFileCache(file);
    const tags = cache ? getAllTags(cache) : null;
    if (!tags) { continue; }
    if (tags.some((t) => (t.startsWith('#') ? t.slice(1) : t) === normalized)) {
      count++;
      if (verbose) { files.push(file.path); }
    }
  }
  return { name: normalized, count, ...(verbose ? { files } : {}) };
}

/** Graph analysis: orphans (no backlinks), deadends (no outgoing links), and unresolved wikilinks. */
export function getGraphAnalysis(
  app: App,
  actions: ('orphans' | 'deadends' | 'unresolved')[],
  options?: { includeNonMarkdown?: boolean; limit?: number },
): VaultGraphResult {
  const limit = options?.limit ?? 200;
  const includeNonMarkdown = options?.includeNonMarkdown ?? false;

  const result: VaultGraphResult = { orphans: [], deadends: [], unresolved: [] };

  // Collect all files that appear as a link destination (for orphans)
  const linkedDestinations = new Set<string>();
  if (actions.includes('orphans')) {
    for (const destinations of Object.values(app.metadataCache.resolvedLinks)) {
      for (const dest of Object.keys(destinations)) {
        linkedDestinations.add(dest);
      }
    }
  }

  if (actions.includes('orphans') || actions.includes('deadends')) {
    const allFiles = includeNonMarkdown ? app.vault.getFiles() : app.vault.getMarkdownFiles();

    if (actions.includes('orphans')) {
      result.orphans = allFiles
        .map((file) => file.path)
        .filter((path) => !linkedDestinations.has(path))
        .sort((a, b) => a.localeCompare(b))
        .slice(0, limit);
    }

    if (actions.includes('deadends')) {
      result.deadends = allFiles
        .filter((file) => (app.metadataCache.getFileCache(file)?.links?.length ?? 0) === 0)
        .map((file) => file.path)
        .sort((a, b) => a.localeCompare(b))
        .slice(0, limit);
    }
  }

  if (actions.includes('unresolved')) {
    for (const [source, targets] of Object.entries(app.metadataCache.unresolvedLinks)) {
      for (const [target, count] of Object.entries(targets)) {
        result.unresolved.push({ source, target, count });
        if (result.unresolved.length >= limit) { break; }
      }
      if (result.unresolved.length >= limit) { break; }
    }
  }

  return result;
}

export function getRecentFiles(app: App, limit?: number): VaultRecentFile[] {
  const max = limit && limit > 0 ? limit : 20;
  const recentPaths = app.workspace.getLastOpenFiles().slice(0, max);
  return recentPaths.map((p) => {
    const file = app.vault.getAbstractFileByPath(p);
    return file instanceof TFile
      ? { path: p, basename: file.basename, mtime: file.stat.mtime }
      : { path: p, basename: p.split('/').pop() ?? p, mtime: null };
  });
}

/** List Bases config files in the vault using the public vault API. */
export function getBaseFiles(app: App): VaultBaseFile[] {
  return app.vault.getFiles()
    .filter((file) => file.extension === 'base')
    .map((file) => ({
      path: file.path,
      basename: file.basename,
      size: file.stat.size,
      mtime: file.stat.mtime,
    }))
    .sort((a, b) => a.path.localeCompare(b.path));
}

function toVaultBaseView(view: unknown): VaultBaseView | null {
  if (!view || typeof view !== 'object') {
    return null;
  }
  const record = view as Partial<BasesConfigFileView>;
  if (typeof record.name !== 'string' || typeof record.type !== 'string') {
    return null;
  }
  return {
    name: record.name,
    type: record.type,
    columns: Array.isArray(record.order)
      ? record.order.filter((column): column is string => typeof column === 'string')
      : [],
  };
}

/** Parse configured Bases views from `.base` file content. */
export function parseBaseViews(content: string, path: string): VaultBaseView[] {
  let config: Partial<BasesConfigFile> | null;
  try {
    config = parseYaml(content) as Partial<BasesConfigFile> | null;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to parse base file ${path}: ${detail}`, { cause: error });
  }

  return Array.isArray(config?.views)
    ? config.views
      .map((view) => toVaultBaseView(view))
      .filter((view): view is VaultBaseView => view !== null)
    : [];
}

/** Vault-wide frontmatter property index, or the usage count of one property when `name` is set. */
export function getVaultPropertyIndex(
  app: App,
  name: string | undefined,
  sort: 'name' | 'count',
): { properties: VaultPropertyIndexEntry[]; value?: number; total: number } {
  const counts = new Map<string, number>();
  for (const markdownFile of app.vault.getMarkdownFiles()) {
    const frontmatter = app.metadataCache.getFileCache(markdownFile)?.frontmatter;
    for (const key of Object.keys(frontmatter ?? {})) {
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  if (name) {
    return { properties: [], value: counts.get(name) ?? 0, total: counts.get(name) ?? 0 };
  }
  const entries: VaultPropertyIndexEntry[] = [...counts.entries()].map(([propertyName, count]) => ({
    name: propertyName,
    count,
  }));
  entries.sort((a, b) => (
    sort === 'count'
      ? b.count - a.count || a.name.localeCompare(b.name)
      : a.name.localeCompare(b.name)
  ));
  return { properties: entries, total: entries.length };
}

/** Vault-wide alias index sorted by alias; `verbose` includes the declaring note paths. */
export function getVaultAliasIndex(app: App, verbose: boolean): VaultAliasEntry[] {
  const byAlias = new Map<string, string[]>();
  for (const markdownFile of app.vault.getMarkdownFiles()) {
    const aliases = parseFrontMatterAliases(
      app.metadataCache.getFileCache(markdownFile)?.frontmatter ?? null,
    ) ?? [];
    for (const alias of aliases) {
      const files = byAlias.get(alias) ?? [];
      files.push(markdownFile.path);
      byAlias.set(alias, files);
    }
  }
  return [...byAlias.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([alias, files]) => ({
      alias,
      count: files.length,
      ...(verbose ? { files } : {}),
    }));
}

function asFile(abstract: TAbstractFile | null): TFile | null {
  return abstract instanceof TFile ? abstract : null;
}

/** Resolve a `.base` file by vault path, or by name/linkpath with the extension optional. */
export function resolveBaseFile(
  app: App,
  vaultPath: string | null,
  file?: string,
  path?: string,
): TFile | null {
  if (path?.trim()) {
    const normalized = normalizePathForVault(path.trim(), vaultPath);
    if (!normalized) {
      return null;
    }
    const resolved = asFile(app.vault.getAbstractFileByPath(normalized));
    return resolved?.extension === 'base' ? resolved : null;
  }

  if (file?.trim()) {
    const query = file.trim();
    const normalized = normalizePathForVault(query, vaultPath);
    const directPaths = normalized
      ? new Set([normalized, normalized.endsWith('.base') ? normalized : `${normalized}.base`])
      : new Set<string>();
    for (const candidate of directPaths) {
      const resolved = asFile(app.vault.getAbstractFileByPath(candidate));
      if (resolved?.extension === 'base') {
        return resolved;
      }
    }

    const linkpath = query.endsWith('.base') ? query : `${query}.base`;
    const linked = app.metadataCache.getFirstLinkpathDest(linkpath, '');
    return linked?.extension === 'base' ? linked : null;
  }

  return null;
}

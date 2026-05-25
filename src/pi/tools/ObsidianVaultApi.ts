import { type App, type CachedMetadata, getAllTags, type TAbstractFile, TFile } from 'obsidian';

import { getVaultPath, normalizePathForVault } from '../../utils/path';

export interface VaultSearchHit {
  path: string;
  line?: number;
  matches?: string[];
}

export interface VaultNoteInfo {
  path: string;
  basename: string;
  extension: string;
  size: number;
  ctime: number;
  mtime: number;
  tags: string[];
  links: string[];
  frontmatter: Record<string, unknown> | null;
}

export interface VaultLinkEntry {
  path: string;
  count: number;
  display?: string;
}

export class ObsidianVaultApi {
  constructor(private readonly app: App) {}

  private vaultPath(): string | null {
    return getVaultPath(this.app);
  }

  private asFile(abstract: TAbstractFile | null): TFile | null {
    return abstract instanceof TFile ? abstract : null;
  }

  resolveFile(file?: string, path?: string): TFile | null {
    if (path?.trim()) {
      const normalized = normalizePathForVault(path.trim(), this.vaultPath());
      if (!normalized) {
        return null;
      }
      return this.asFile(this.app.vault.getAbstractFileByPath(normalized));
    }
    if (file?.trim()) {
      const dest = this.app.metadataCache.getFirstLinkpathDest(file.trim(), '');
      return dest ?? null;
    }
    const active = this.app.workspace.getActiveFile();
    return active ?? null;
  }

  async readNote(file?: string, path?: string): Promise<{ path: string; content: string }> {
    const resolved = this.resolveFile(file, path);
    if (!resolved) {
      throw new Error('Note not found. Provide file= (wikilink name) or path= (vault-relative).');
    }
    const content = await this.app.vault.read(resolved);
    return { path: resolved.path, content };
  }

  async writeNote(params: {
    file?: string;
    path?: string;
    content: string;
    mode: 'create' | 'overwrite' | 'append' | 'prepend';
    overwrite?: boolean;
  }): Promise<{ path: string }> {
    const { content, mode } = params;
    if (mode === 'append' || mode === 'prepend') {
      const resolved = this.resolveFile(params.file, params.path);
      if (!resolved) {
        throw new Error('Note not found for append/prepend.');
      }
      const existing = await this.app.vault.read(resolved);
      const next = mode === 'append' ? `${existing}${content}` : `${content}${existing}`;
      await this.app.vault.modify(resolved, next);
      return { path: resolved.path };
    }

    let targetPath = params.path?.trim();
    if (!targetPath && params.file?.trim()) {
      const name = params.file.trim().endsWith('.md') ? params.file.trim() : `${params.file.trim()}.md`;
      targetPath = name;
    }
    if (!targetPath) {
      throw new Error('path= or file= required for create/overwrite.');
    }

    const normalized = normalizePathForVault(targetPath, this.vaultPath());
    if (!normalized) {
      throw new Error('Invalid vault path.');
    }

    const existing = this.asFile(this.app.vault.getAbstractFileByPath(normalized));
    if (existing && !params.overwrite && mode === 'create') {
      throw new Error(`File already exists: ${normalized}`);
    }

    if (existing) {
      await this.app.vault.modify(existing, content);
      return { path: normalized };
    }

    await this.app.vault.create(normalized, content);
    return { path: normalized };
  }

  getVaultName(): string {
    const named = this.app.vault.getName?.();
    if (typeof named === 'string' && named.length > 0) {
      return named;
    }
    const base = getVaultPath(this.app);
    return base ? base.split('/').filter(Boolean).pop() ?? 'vault' : 'vault';
  }

  /** In-process vault search (no CLI). Supports plain text, tag:, path: prefixes, and folder listing. */
  async searchNotes(params: {
    query: string;
    path?: string;
    limit?: number;
    context?: boolean;
  }): Promise<VaultSearchHit[]> {
    const limit = params.limit ?? 50;
    let folderPrefix = params.path?.trim().replace(/\/+$/, '') ?? '';
    let textQuery = params.query.trim();
    let tagFilter: string | null = null;

    if (textQuery.startsWith('tag:')) {
      tagFilter = textQuery.slice(4).trim().replace(/^#/, '');
      textQuery = '';
    } else if (textQuery.startsWith('path:')) {
      folderPrefix = textQuery.slice(5).trim().replace(/\/+$/, '');
      textQuery = '';
    }

    const listAllInScope = textQuery === '*'
      || textQuery === ''
      || textQuery === '**';
    const needle = listAllInScope ? '' : textQuery.toLowerCase();
    const hits: VaultSearchHit[] = [];

    for (const file of this.app.vault.getMarkdownFiles()) {
      if (folderPrefix && !file.path.startsWith(`${folderPrefix}/`) && file.path !== folderPrefix) {
        continue;
      }

      if (tagFilter) {
        const cache = this.app.metadataCache.getFileCache(file);
        const tags = cache ? getAllTags(cache) : null;
        if (!tags?.some((t) => t === tagFilter || t === `#${tagFilter}`)) {
          continue;
        }
      }

      if (!needle) {
        hits.push({ path: file.path });
        if (hits.length >= limit) {
          break;
        }
        continue;
      }

      const content = await this.app.vault.cachedRead(file);
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (!lines[i].toLowerCase().includes(needle)) {
          continue;
        }
        const hit: VaultSearchHit = { path: file.path, line: i + 1 };
        if (params.context) {
          const start = Math.max(0, i - 2);
          const end = Math.min(lines.length, i + 3);
          hit.matches = lines.slice(start, end);
        }
        hits.push(hit);
        if (hits.length >= limit) {
          return hits;
        }
      }
    }

    return hits;
  }

  getNoteInfo(file?: string, path?: string): VaultNoteInfo {
    const resolved = this.resolveFile(file, path);
    if (!resolved) {
      throw new Error('Note not found. Provide file= or path=.');
    }
    const cache = this.app.metadataCache.getFileCache(resolved);
    return {
      path: resolved.path,
      basename: resolved.basename,
      extension: resolved.extension,
      size: resolved.stat.size,
      ctime: resolved.stat.ctime,
      mtime: resolved.stat.mtime,
      tags: cache ? (getAllTags(cache) ?? []) : [],
      links: this.outgoingLinkPaths(resolved, cache),
      frontmatter: cache?.frontmatter ?? null,
    };
  }

  getLinks(
    file?: string,
    path?: string,
    direction: 'outgoing' | 'backlinks' = 'outgoing',
  ): { path: string; links: VaultLinkEntry[] } {
    const resolved = this.resolveFile(file, path);
    if (!resolved) {
      throw new Error('Note not found. Provide file= or path=.');
    }

    if (direction === 'backlinks') {
      return {
        path: resolved.path,
        links: this.collectBacklinks(resolved.path),
      };
    }

    const cache = this.app.metadataCache.getFileCache(resolved);
    const links: VaultLinkEntry[] = [];
    const seen = new Map<string, VaultLinkEntry>();

    for (const link of cache?.links ?? []) {
      const dest = this.app.metadataCache.getFirstLinkpathDest(link.link, resolved.path);
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

    return { path: resolved.path, links };
  }

  private outgoingLinkPaths(file: TFile, cache: CachedMetadata | null): string[] {
    const paths = new Set<string>();
    for (const link of cache?.links ?? []) {
      const dest = this.app.metadataCache.getFirstLinkpathDest(link.link, file.path);
      paths.add(dest?.path ?? link.link);
    }
    return [...paths];
  }

  private collectBacklinks(targetPath: string): VaultLinkEntry[] {
    const links: VaultLinkEntry[] = [];
    for (const [sourcePath, destinations] of Object.entries(this.app.metadataCache.resolvedLinks)) {
      const count = destinations[targetPath];
      if (count) {
        links.push({ path: sourcePath, count });
      }
    }
    return links.sort((a, b) => a.path.localeCompare(b.path));
  }
}

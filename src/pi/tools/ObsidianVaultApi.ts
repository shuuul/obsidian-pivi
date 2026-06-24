import { type App, type CachedMetadata, getAllTags, type TAbstractFile, TFile, TFolder } from 'obsidian';

import type { StructuredPatchHunk } from '../../core/types/diff';
import { buildSubstringPatchHunks } from '../../utils/diff';
import { getVaultPath, normalizePathForVault } from '../../utils/path';
import { buildOldStringNotFoundMessage } from '../../utils/vaultEditMatch';

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

export interface VaultDeleteResult {
  path: string;
  kind: 'file' | 'folder';
}

export interface VaultPathEntry {
  path: string;
  kind: 'file' | 'folder';
  name: string;
  extension?: string;
  size?: number;
}

export interface VaultAttachmentInfo {
  path?: string;
  availablePath?: string;
  resourcePath?: string;
  size?: number;
  extension?: string;
}

export class ObsidianVaultApi {
  constructor(private readonly app: App) {}

  private vaultPath(): string | null {
    return getVaultPath(this.app);
  }

  private asFile(abstract: TAbstractFile | null): TFile | null {
    return abstract instanceof TFile ? abstract : null;
  }

  private resolveAbstract(path: string): TAbstractFile | null {
    const normalized = normalizePathForVault(path.trim(), this.vaultPath());
    if (!normalized) {
      return null;
    }
    return this.app.vault.getAbstractFileByPath(normalized);
  }

  private requireAbstract(path: string): TAbstractFile {
    const resolved = this.resolveAbstract(path);
    if (!resolved) {
      throw new Error(`Vault path not found: ${path}`);
    }
    return resolved;
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

  async editNote(params: {
    file?: string;
    path?: string;
    old_string: string;
    new_string: string;
    replace_all?: boolean;
  }): Promise<{
    path: string;
    replacements: number;
    structuredPatch: StructuredPatchHunk[];
  }> {
    const resolved = this.resolveFile(params.file, params.path);
    if (!resolved) {
      throw new Error('Note not found. Provide file= (wikilink name) or path= (vault-relative).');
    }
    const oldString = params.old_string;
    if (!oldString) {
      throw new Error('old_string must not be empty.');
    }
    const newString = params.new_string;
    const replaceAll = Boolean(params.replace_all);

    let replacements = 0;
    await this.app.vault.process(resolved, (data) => {
      const parts = data.split(oldString);
      const count = parts.length - 1;
      if (count === 0) {
        throw new Error(buildOldStringNotFoundMessage(resolved.path, data, oldString));
      }
      if (count > 1 && !replaceAll) {
        throw new Error(
          `old_string appears ${count} times in ${resolved.path}; use replace_all or include more context`,
        );
      }
      replacements = count;
      return replaceAll ? parts.join(newString) : data.replace(oldString, newString);
    });

    return {
      path: resolved.path,
      replacements,
      structuredPatch: buildSubstringPatchHunks(oldString, newString),
    };
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
      await this.app.vault.process(resolved, (data) =>
        mode === 'append' ? `${data}${content}` : `${content}${data}`,
      );
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
      await this.app.vault.process(existing, () => content);
      return { path: normalized };
    }

    await this.app.vault.create(normalized, content);
    return { path: normalized };
  }

  async trashPath(params: { file?: string; path?: string }): Promise<VaultDeleteResult> {
    let target: TAbstractFile | null = null;
    if (params.path?.trim()) {
      target = this.resolveAbstract(params.path);
    } else if (params.file?.trim()) {
      target = this.resolveFile(params.file, undefined);
    }

    if (!target) {
      throw new Error('File or folder not found. Provide path= (vault-relative) or file= (note title).');
    }

    await this.app.fileManager.trashFile(target);
    return {
      path: target.path,
      kind: target instanceof TFolder ? 'folder' : 'file',
    };
  }

  async movePath(params: { path: string; newPath: string }): Promise<{ path: string; newPath: string }> {
    const target = this.requireAbstract(params.path);
    const normalizedNewPath = normalizePathForVault(params.newPath.trim(), this.vaultPath());
    if (!normalizedNewPath) {
      throw new Error('Invalid destination path.');
    }
    await this.app.fileManager.renameFile(target, normalizedNewPath);
    return { path: target.path, newPath: normalizedNewPath };
  }

  async createFolder(path: string): Promise<{ path: string }> {
    const normalized = normalizePathForVault(path.trim(), this.vaultPath());
    if (!normalized) {
      throw new Error('Invalid folder path.');
    }
    await this.app.vault.createFolder(normalized);
    return { path: normalized };
  }

  listPath(path = ''): VaultPathEntry[] {
    const normalized = normalizePathForVault(path.trim(), this.vaultPath()) ?? '';
    const target = normalized ? this.requireAbstract(normalized) : this.app.vault.getRoot();
    if (!(target instanceof TFolder)) {
      throw new Error(`Vault path is not a folder: ${path}`);
    }
    return target.children.map((child) => {
      if (child instanceof TFolder) {
        return { path: child.path, kind: 'folder', name: child.name };
      }
      if (!(child instanceof TFile)) {
        throw new Error(`Unsupported vault entry: ${child.path}`);
      }
      const file = child;
      return {
        path: file.path,
        kind: 'file',
        name: file.name,
        extension: file.extension,
        size: file.stat.size,
      };
    });
  }

  async openPath(path: string, newLeaf: boolean | 'tab' | 'split' | 'window' = false): Promise<{ path: string }> {
    const target = this.requireAbstract(path);
    if (!(target instanceof TFile)) {
      throw new Error(`Vault path is not a file: ${path}`);
    }
    const leaf = this.app.workspace.getLeaf(newLeaf);
    await leaf.openFile(target);
    this.app.workspace.setActiveLeaf(leaf, { focus: true });
    return { path: target.path };
  }

  getProperties(file?: string, path?: string, name?: string): { path?: string; properties: Record<string, unknown> | string[]; value?: unknown } {
    if (!file && !path) {
      const names = new Set<string>();
      for (const markdownFile of this.app.vault.getMarkdownFiles()) {
        const frontmatter = this.app.metadataCache.getFileCache(markdownFile)?.frontmatter;
        for (const key of Object.keys(frontmatter ?? {})) {
          names.add(key);
        }
      }
      return { properties: [...names].sort() };
    }
    const resolved = this.resolveFile(file, path);
    if (!resolved) {
      throw new Error('Note not found. Provide file= or path=.');
    }
    const properties = this.app.metadataCache.getFileCache(resolved)?.frontmatter ?? {};
    if (name) {
      return { path: resolved.path, properties, value: properties[name] };
    }
    return { path: resolved.path, properties };
  }

  async setProperty(file: string | undefined, path: string | undefined, name: string, value: string): Promise<{ path: string; name: string }> {
    const resolved = this.resolveFile(file, path);
    if (!resolved) {
      throw new Error('Note not found. Provide file= or path=.');
    }
    await this.app.fileManager.processFrontMatter(resolved, (frontmatter: Record<string, unknown>) => {
      frontmatter[name] = value;
    });
    return { path: resolved.path, name };
  }

  async removeProperty(file: string | undefined, path: string | undefined, name: string): Promise<{ path: string; name: string }> {
    const resolved = this.resolveFile(file, path);
    if (!resolved) {
      throw new Error('Note not found. Provide file= or path=.');
    }
    await this.app.fileManager.processFrontMatter(resolved, (frontmatter: Record<string, unknown>) => {
      delete frontmatter[name];
    });
    return { path: resolved.path, name };
  }

  async getAttachmentInfo(params: { path?: string; filename?: string; sourcePath?: string }): Promise<VaultAttachmentInfo> {
    if (params.path?.trim()) {
      const target = this.requireAbstract(params.path);
      if (!(target instanceof TFile)) {
        throw new Error(`Vault path is not a file: ${params.path}`);
      }
      return {
        path: target.path,
        resourcePath: this.app.vault.getResourcePath(target),
        size: target.stat.size,
        extension: target.extension,
      };
    }
    if (!params.filename?.trim()) {
      throw new Error('filename= or path= is required.');
    }
    return {
      availablePath: await this.app.fileManager.getAvailablePathForAttachment(
        params.filename.trim(),
        params.sourcePath,
      ),
    };
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

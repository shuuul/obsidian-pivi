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

import { getVaultPath, normalizePathForVault } from './path';

function asciiDoubleQuotesToCurly(text: string): string {
  let useOpen = true;
  return text.replace(/"/g, () => {
    const ch = useOpen ? '\u201c' : '\u201d';
    useOpen = !useOpen;
    return ch;
  });
}

function curlyDoubleQuotesToAscii(text: string): string {
  return text.replace(/[\u201c\u201d]/g, '"');
}

function buildOldStringNotFoundMessage(
  filePath: string,
  content: string,
  oldString: string,
): string {
  const base = `old_string not found in ${filePath}. `
    + 'Copy the exact substring from obsidian_read (same quotes, spaces, and line breaks).';

  const curlyCandidate = asciiDoubleQuotesToCurly(oldString);
  if (curlyCandidate !== oldString && content.includes(curlyCandidate)) {
    return `${base} old_string uses ASCII straight quotes (") but the note uses curly quotes (“ ”). `
      + 'Copy old_string verbatim from the latest obsidian_read output.';
  }

  const asciiCandidate = curlyDoubleQuotesToAscii(oldString);
  if (asciiCandidate !== oldString && content.includes(asciiCandidate)) {
    return `${base} old_string uses curly quotes (“ ”) but the note uses ASCII straight quotes ("). `
      + 'Copy old_string verbatim from the latest obsidian_read output.';
  }

  return base;
}

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
  wordCount: number;
  characterCount: number;
  aliases: string[];
}

export interface VaultTagEntry {
  name: string;
  count: number;
}

export interface VaultGraphResult {
  orphans: string[];
  deadends: string[];
  unresolved: { source: string; target: string; count: number }[];
}

export interface VaultRecentFile {
  path: string;
  basename: string;
  mtime: number | null;
}

export interface VaultBaseFile {
  path: string;
  basename: string;
  size: number;
  mtime: number;
}

export interface VaultBaseView {
  name: string;
  type: string;
  columns: string[];
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
  markdown?: string;
  resourcePath?: string;
  size?: number;
  extension?: string;
}

export interface VaultWriteAttachmentResult {
  path: string;
  markdown: string;
  resourcePath: string;
  size: number;
  extension: string;
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

  private resolveBaseFile(file?: string, path?: string): TFile | null {
    if (path?.trim()) {
      const normalized = normalizePathForVault(path.trim(), this.vaultPath());
      if (!normalized) {
        return null;
      }
      const resolved = this.asFile(this.app.vault.getAbstractFileByPath(normalized));
      return resolved?.extension === 'base' ? resolved : null;
    }

    if (file?.trim()) {
      const query = file.trim();
      const normalized = normalizePathForVault(query, this.vaultPath());
      const directPaths = normalized
        ? new Set([normalized, normalized.endsWith('.base') ? normalized : `${normalized}.base`])
        : new Set<string>();
      for (const candidate of directPaths) {
        const resolved = this.asFile(this.app.vault.getAbstractFileByPath(candidate));
        if (resolved?.extension === 'base') {
          return resolved;
        }
      }

      const linkpath = query.endsWith('.base') ? query : `${query}.base`;
      const linked = this.app.metadataCache.getFirstLinkpathDest(linkpath, '');
      return linked?.extension === 'base' ? linked : null;
    }

    return null;
  }

  getActiveFilePath(): string | null {
    return this.app.workspace.getActiveFile()?.path ?? null;
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
        markdown: this.app.fileManager.generateMarkdownLink(target, params.sourcePath ?? ''),
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

  async writeAttachment(params: {
    filename: string;
    data: ArrayBuffer;
    sourcePath?: string;
  }): Promise<VaultWriteAttachmentResult> {
    const filename = params.filename.trim();
    if (!filename) {
      throw new Error('filename must not be empty.');
    }
    const availablePath = await this.app.fileManager.getAvailablePathForAttachment(
      filename,
      params.sourcePath,
    );
    const normalized = normalizePathForVault(availablePath, this.vaultPath());
    if (!normalized) {
      throw new Error('Invalid attachment path.');
    }

    const file = await this.app.vault.createBinary(normalized, params.data);
    return {
      path: file.path,
      markdown: this.app.fileManager.generateMarkdownLink(file, params.sourcePath ?? ''),
      resourcePath: this.app.vault.getResourcePath(file),
      size: file.stat.size,
      extension: file.extension,
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
      for (const [lineIndex, line] of lines.entries()) {
        if (!line.toLowerCase().includes(needle)) {
          continue;
        }
        const hit: VaultSearchHit = { path: file.path, line: lineIndex + 1 };
        if (params.context) {
          const start = Math.max(0, lineIndex - 2);
          const end = Math.min(lines.length, lineIndex + 3);
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

  async getNoteInfo(file?: string, path?: string): Promise<VaultNoteInfo> {
    const resolved = this.resolveFile(file, path);
    if (!resolved) {
      throw new Error('Note not found. Provide file= or path=.');
    }
    const cache = this.app.metadataCache.getFileCache(resolved);
    const content = await this.app.vault.cachedRead(resolved);
    const wordCount = content.trim().split(/\s+/).filter(Boolean).length;
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
      wordCount,
      characterCount: content.length,
      aliases: parseFrontMatterAliases(cache?.frontmatter ?? null) ?? [],
    };
  }

  /** List Bases config files in the vault using the public vault API. */
  getBaseFiles(): VaultBaseFile[] {
    return this.app.vault.getFiles()
      .filter((file) => file.extension === 'base')
      .map((file) => ({
        path: file.path,
        basename: file.basename,
        size: file.stat.size,
        mtime: file.stat.mtime,
      }))
      .sort((a, b) => a.path.localeCompare(b.path));
  }

  /** Read configured Bases views from a `.base` file without relying on active-file CLI state. */
  async getBaseViews(file?: string, path?: string): Promise<{ path: string; views: VaultBaseView[] }> {
    const resolved = this.resolveBaseFile(file, path);
    if (!resolved) {
      throw new Error('Base file not found. Provide file= or path= for a .base file.');
    }

    const content = await this.app.vault.cachedRead(resolved);
    let config: Partial<BasesConfigFile> | null;
    try {
      config = parseYaml(content) as Partial<BasesConfigFile> | null;
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to parse base file ${resolved.path}: ${detail}`, { cause: error });
    }

    const views = Array.isArray(config?.views)
      ? config.views
        .map((view) => this.toVaultBaseView(view))
        .filter((view): view is VaultBaseView => view !== null)
      : [];
    return { path: resolved.path, views };
  }

  /** List all tags in the vault with occurrence counts. */
  getTags(sort: 'name' | 'count' = 'name'): VaultTagEntry[] {
    const counts = new Map<string, number>();
    for (const file of this.app.vault.getMarkdownFiles()) {
      const cache = this.app.metadataCache.getFileCache(file);
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

  /** Get details for a single tag: count and list of files containing it. */
  getTagInfo(tag: string, verbose?: boolean): { name: string; count: number; files?: string[] } {
    const normalized = tag.replace(/^#/, '').trim();
    let count = 0;
    const files: string[] = [];
    for (const file of this.app.vault.getMarkdownFiles()) {
      const cache = this.app.metadataCache.getFileCache(file);
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
  getGraphAnalysis(
    actions: ('orphans' | 'deadends' | 'unresolved')[],
    options?: { includeNonMarkdown?: boolean; limit?: number },
  ): VaultGraphResult {
    const limit = options?.limit ?? 200;
    const includeNonMarkdown = options?.includeNonMarkdown ?? false;

    const result: VaultGraphResult = { orphans: [], deadends: [], unresolved: [] };

    // Collect all files that appear as a link destination (for orphans)
    const linkedDestinations = new Set<string>();
    if (actions.includes('orphans')) {
      for (const destinations of Object.values(this.app.metadataCache.resolvedLinks)) {
        for (const dest of Object.keys(destinations)) {
          linkedDestinations.add(dest);
        }
      }
    }

    if (actions.includes('orphans') || actions.includes('deadends')) {
      const allFiles = includeNonMarkdown ? this.app.vault.getFiles() : this.app.vault.getMarkdownFiles();

      if (actions.includes('orphans')) {
        result.orphans = allFiles
          .map((file) => file.path)
          .filter((path) => !linkedDestinations.has(path))
          .sort((a, b) => a.localeCompare(b))
          .slice(0, limit);
      }

      if (actions.includes('deadends')) {
        result.deadends = allFiles
          .filter((file) => (this.app.metadataCache.getFileCache(file)?.links?.length ?? 0) === 0)
          .map((file) => file.path)
          .sort((a, b) => a.localeCompare(b))
          .slice(0, limit);
      }
    }

    if (actions.includes('unresolved')) {
      for (const [source, targets] of Object.entries(this.app.metadataCache.unresolvedLinks)) {
        for (const [target, count] of Object.entries(targets)) {
          result.unresolved.push({ source, target, count });
          if (result.unresolved.length >= limit) { break; }
        }
        if (result.unresolved.length >= limit) { break; }
      }
    }

    return result;
  }

  /** List recently opened files. */
  getRecentFiles(limit?: number): VaultRecentFile[] {
    const max = limit && limit > 0 ? limit : 20;
    const recentPaths = this.app.workspace.getLastOpenFiles().slice(0, max);
    return recentPaths.map((p) => {
      const file = this.app.vault.getAbstractFileByPath(p);
      return file instanceof TFile
        ? { path: p, basename: file.basename, mtime: file.stat.mtime }
        : { path: p, basename: p.split('/').pop() ?? p, mtime: null };
    });
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

  private toVaultBaseView(view: unknown): VaultBaseView | null {
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

  public triggerVaultModify(path: string): void {
    const normalized = normalizePathForVault(path.trim(), this.vaultPath());
    if (!normalized) return;

    const file = this.app.vault.getAbstractFileByPath(normalized);
    if (file instanceof TFile) {
      this.app.vault.trigger('modify', file);
    } else {
      const idx = normalized.lastIndexOf('/');
      const parentDir = idx >= 0 ? normalized.substring(0, idx) : '';
      this.app.vault.adapter.list(parentDir).catch(() => {});
    }
  }
}

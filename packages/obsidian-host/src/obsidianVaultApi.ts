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

import { captureFileRecoverySnapshot } from './fileRecoverySnapshot';
import {
  type AgentManagedPathMutationMode,
  getVaultPath,
  normalizePathForVault,
  requireAgentVaultMutationPath,
} from './path';
import { applyVaultEdits, type VaultEditItem } from './vaultEditMatch';

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

export interface VaultPropertyIndexEntry {
  name: string;
  count: number;
}

export interface VaultAliasEntry {
  alias: string;
  count: number;
  files?: string[];
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

  /**
   * Canonical vault-relative mutation path with containment + managed-namespace
   * policy (spec 040). Used by Agent-facing vault tools; Settings/coordinators
   * persist through FileStore adapters and do not call these mutation methods.
   */
  private requireMutationPath(
    rawPath: string,
    options: { mode?: AgentManagedPathMutationMode } = {},
  ): string {
    return requireAgentVaultMutationPath(rawPath, this.vaultPath(), options);
  }

  /** Apply managed-path policy to an already-resolved Obsidian vault path (e.g. file= alias). */
  private assertResolvedMutationPath(
    vaultRelativePath: string,
    options: { mode?: AgentManagedPathMutationMode } = {},
  ): void {
    this.requireMutationPath(vaultRelativePath, options);
  }

  private asFile(abstract: TAbstractFile | null): TFile | null {
    return abstract instanceof TFile ? abstract : null;
  }

  private async capturePreWriteSnapshot(file: TFile): Promise<void> {
    await captureFileRecoverySnapshot(this.app, file);
  }

  private async captureMutationSnapshots(target: TAbstractFile): Promise<void> {
    if (target instanceof TFile) {
      await this.capturePreWriteSnapshot(target);
      return;
    }
    if (target instanceof TFolder) {
      for (const child of target.children) {
        await this.captureMutationSnapshots(child);
      }
    }
  }

  private resolveAbstract(path: string): TAbstractFile | null {
    const normalized = normalizePathForVault(path.trim(), this.vaultPath());
    if (!normalized) {
      return null;
    }
    return this.app.vault.getAbstractFileByPath(normalized);
  }

  private requireMutationAbstract(
    path: string,
    options: { mode?: AgentManagedPathMutationMode } = {},
  ): TAbstractFile {
    const normalized = this.requireMutationPath(path.trim(), options);
    const resolved = this.app.vault.getAbstractFileByPath(normalized);
    if (!resolved) {
      throw new Error(`Vault path not found: ${path}`);
    }
    return resolved;
  }

  private requireAbstract(path: string): TAbstractFile {
    const resolved = this.resolveAbstract(path);
    if (!resolved) {
      throw new Error(`Vault path not found: ${path}`);
    }
    return resolved;
  }

  private resolveOptionalMarkdownFile(file?: string, path?: string, active?: boolean): TFile | null {
    if (file?.trim() || path?.trim()) {
      const resolved = this.resolveFile(file, path);
      if (!resolved) {
        throw new Error('Note not found.');
      }
      return resolved;
    }
    if (active === true) {
      const resolved = this.resolveFile();
      if (!resolved) {
        throw new Error('No active file.');
      }
      return resolved;
    }
    return null;
  }

  private resolveTagFiles(scope?: { file?: string; path?: string; active?: boolean }): TFile[] {
    const resolved = this.resolveOptionalMarkdownFile(scope?.file, scope?.path, scope?.active);
    return resolved ? [resolved] : this.app.vault.getMarkdownFiles();
  }

  private resolveMutationFile(
    file?: string,
    path?: string,
    options: { mode?: AgentManagedPathMutationMode } = {},
  ): TFile {
    if (path?.trim()) {
      const normalized = this.requireMutationPath(path, options);
      const resolved = this.asFile(this.app.vault.getAbstractFileByPath(normalized));
      if (!resolved) {
        throw new Error(`Vault path not found: ${path}`);
      }
      return resolved;
    }
    const resolved = this.resolveFile(file, undefined);
    if (!resolved) {
      throw new Error('Note not found.');
    }
    // file= aliases resolve outside requireMutationPath; enforce policy on the real path.
    this.assertResolvedMutationPath(resolved.path, options);
    return resolved;
  }

  resolveFile(file?: string, path?: string): TFile | null {
    const byVaultPath = (value?: string): TFile | null => {
      if (!value?.trim()) {
        return null;
      }
      const normalized = normalizePathForVault(value.trim(), this.vaultPath());
      if (!normalized) {
        return null;
      }
      return this.asFile(this.app.vault.getAbstractFileByPath(normalized));
    };
    const byWikilink = (value?: string): TFile | null => {
      if (!value?.trim()) {
        return null;
      }
      return this.app.metadataCache.getFirstLinkpathDest(value.trim(), '') ?? null;
    };

    if (path?.trim()) {
      const fromPath = byVaultPath(path) ?? byWikilink(path);
      if (fromPath) {
        return fromPath;
      }
    }
    if (file?.trim()) {
      const fromFile = byWikilink(file) ?? byVaultPath(file);
      if (fromFile) {
        return fromFile;
      }
    }
    if (path?.trim() || file?.trim()) {
      return null;
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
      throw new Error('Note not found.');
    }
    const content = await this.app.vault.read(resolved);
    return { path: resolved.path, content };
  }

  async editNote(params: {
    file?: string;
    path?: string;
    edits?: VaultEditItem[];
    old_string?: string;
    new_string?: string;
    replace_all?: boolean;
  }): Promise<{
    path: string;
    replacements: number;
  }> {
    const resolved = this.resolveMutationFile(params.file, params.path);
    const edits = params.edits && params.edits.length > 0
      ? params.edits
      : params.old_string !== undefined && params.new_string !== undefined
        ? [{
            oldText: params.old_string,
            newText: params.new_string,
            replaceAll: Boolean(params.replace_all),
          }]
        : [];
    if (edits.length === 0) {
      throw new Error('edits must contain at least one { oldText, newText } item.');
    }

    let replacements = 0;
    await this.capturePreWriteSnapshot(resolved);
    await this.app.vault.process(resolved, (data) => {
      const result = applyVaultEdits({
        filePath: resolved.path,
        content: data,
        edits,
      });
      replacements = result.replacements;
      return result.content;
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
    inline?: boolean;
  }): Promise<{ path: string }> {
    const { content, mode } = params;
    const inline = params.inline === true;
    if (mode === 'append' || mode === 'prepend') {
      const resolved = this.resolveMutationFile(params.file, params.path);
      await this.capturePreWriteSnapshot(resolved);
      await this.app.vault.process(resolved, (data) => (
        mode === 'append'
          ? joinNoteContent(data, content, inline, 'append')
          : prependAfterFrontmatter(data, content, inline)
      ));
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

    const normalized = this.requireMutationPath(targetPath);
    const existing = this.asFile(this.app.vault.getAbstractFileByPath(normalized));
    if (existing && !params.overwrite && mode === 'create') {
      throw new Error(`File already exists: ${normalized}`);
    }

    if (existing) {
      await this.capturePreWriteSnapshot(existing);
      await this.app.vault.process(existing, () => content);
      return { path: normalized };
    }

    await this.app.vault.create(normalized, content);
    return { path: normalized };
  }

  async trashPath(params: { file?: string; path?: string }): Promise<VaultDeleteResult> {
    // Delete is recursive for folders; protect managed descendants and ancestors.
    const recursive = { mode: 'recursive' as const };
    let target: TAbstractFile | null = null;
    if (params.path?.trim()) {
      target = this.requireMutationAbstract(params.path, recursive);
    } else if (params.file?.trim()) {
      target = this.resolveMutationFile(params.file, undefined, recursive);
    }

    if (!target) {
      throw new Error('File or folder not found. Provide path= (vault-relative) or file= (note title).');
    }

    await this.captureMutationSnapshots(target);
    await this.app.fileManager.trashFile(target);
    return {
      path: target.path,
      kind: target instanceof TFolder ? 'folder' : 'file',
    };
  }

  async movePath(params: { path: string; newPath: string }): Promise<{ path: string; newPath: string }> {
    // Source move can recurse into managed trees; destination is a direct write target.
    const target = this.requireMutationAbstract(params.path, { mode: 'recursive' });
    const normalizedNewPath = this.requireMutationPath(params.newPath.trim(), { mode: 'direct' });
    await this.captureMutationSnapshots(target);
    await this.app.fileManager.renameFile(target, normalizedNewPath);
    return { path: target.path, newPath: normalizedNewPath };
  }

  /** Snapshot current recoverable content before a history restore; deleted paths have no current state. */
  async captureSnapshotBeforeRestore(path: string): Promise<void> {
    const normalized = this.requireMutationPath(path);
    const current = this.app.vault.getAbstractFileByPath(normalized);
    if (!current) {
      return;
    }
    if (!(current instanceof TFile)) {
      throw new Error(`Vault path is not a file: ${path}`);
    }
    await this.capturePreWriteSnapshot(current);
  }

  async createFolder(path: string): Promise<{ path: string }> {
    // Creating a parent of a managed root would own that namespace via recursion semantics.
    const normalized = this.requireMutationPath(path.trim(), { mode: 'recursive' });
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

  getProperties(file?: string, path?: string, name?: string, options?: {
    active?: boolean;
    sort?: 'name' | 'count';
  }): {
    path?: string;
    properties: Record<string, unknown> | VaultPropertyIndexEntry[] | string[];
    value?: unknown;
    total?: number;
  } {
    const resolved = this.resolveOptionalMarkdownFile(file, path, options?.active);
    if (!resolved) {
      const counts = new Map<string, number>();
      for (const markdownFile of this.app.vault.getMarkdownFiles()) {
        const frontmatter = this.app.metadataCache.getFileCache(markdownFile)?.frontmatter;
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
      const sort = options?.sort ?? 'name';
      entries.sort((a, b) => (
        sort === 'count'
          ? b.count - a.count || a.name.localeCompare(b.name)
          : a.name.localeCompare(b.name)
      ));
      return { properties: entries, total: entries.length };
    }
    const properties = this.app.metadataCache.getFileCache(resolved)?.frontmatter ?? {};
    if (name) {
      return { path: resolved.path, properties, value: properties[name] };
    }
    return { path: resolved.path, properties };
  }

  getAliases(file?: string, path?: string, options?: {
    active?: boolean;
    verbose?: boolean;
  }): { path?: string; aliases: VaultAliasEntry[] | string[]; total: number } {
    const resolved = this.resolveOptionalMarkdownFile(file, path, options?.active);
    if (resolved) {
      const aliases = parseFrontMatterAliases(
        this.app.metadataCache.getFileCache(resolved)?.frontmatter ?? null,
      ) ?? [];
      return { path: resolved.path, aliases, total: aliases.length };
    }

    const byAlias = new Map<string, string[]>();
    for (const markdownFile of this.app.vault.getMarkdownFiles()) {
      const aliases = parseFrontMatterAliases(
        this.app.metadataCache.getFileCache(markdownFile)?.frontmatter ?? null,
      ) ?? [];
      for (const alias of aliases) {
        const files = byAlias.get(alias) ?? [];
        files.push(markdownFile.path);
        byAlias.set(alias, files);
      }
    }
    const verbose = options?.verbose === true;
    const aliases: VaultAliasEntry[] = [...byAlias.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([alias, files]) => ({
        alias,
        count: files.length,
        ...(verbose ? { files } : {}),
      }));
    return { aliases, total: aliases.length };
  }

  async setProperty(
    file: string | undefined,
    path: string | undefined,
    name: string,
    value: unknown,
  ): Promise<{ path: string; name: string }> {
    const resolved = this.resolveMutationFile(file, path);
    await this.capturePreWriteSnapshot(resolved);
    await this.app.fileManager.processFrontMatter(resolved, (frontmatter: Record<string, unknown>) => {
      frontmatter[name] = value;
    });
    return { path: resolved.path, name };
  }

  async removeProperty(file: string | undefined, path: string | undefined, name: string): Promise<{ path: string; name: string }> {
    const resolved = this.resolveMutationFile(file, path);
    await this.capturePreWriteSnapshot(resolved);
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
    const normalized = this.requireMutationPath(availablePath);

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

  private resolveSearchFiles(scopePath: string): TFile[] {
    const normalized = normalizePathForVault(scopePath, this.vaultPath());
    if (!normalized) {
      throw new Error(`Search path not found: ${scopePath}`);
    }
    const resolved = this.app.vault.getAbstractFileByPath(normalized);
    if (resolved instanceof TFile) {
      if (resolved.extension !== 'md') {
        throw new Error(`search only reads Markdown notes. Use \`read\` for ${resolved.path}.`);
      }
      return [resolved];
    }
    if (resolved instanceof TFolder) {
      if (!resolved.path) {
        throw new Error('search requires a vault-relative path to one Markdown note or a non-root folder. Vault-wide search is not allowed.');
      }
      const prefix = `${resolved.path}/`;
      return this.app.vault.getMarkdownFiles().filter((file) => file.path.startsWith(prefix));
    }
    throw new Error(`Search path not found: ${scopePath}`);
  }

  /** In-process vault search (no CLI). Case-insensitive literal substring plus tag:. Listing queries error toward `ls`. */
  async searchNotes(params: {
    query: string;
    path: string;
    limit?: number;
    offset?: number;
    context?: boolean;
  }): Promise<VaultSearchHit[]> {
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
      throw new Error('search is for note contents and tags, not folder listing. Use `ls` with `path` instead.');
    }

    const listAllInScope = textQuery === '*'
      || textQuery === ''
      || textQuery === '**';
    if (listAllInScope && !tagFilter) {
      throw new Error('search is for note contents and tags, not folder listing. Use `ls` with `path` instead.');
    }

    const requestedPath = params.path?.trim() ?? '';
    if (
      !requestedPath
      || requestedPath === '/'
      || requestedPath === '.'
      || requestedPath === './'
      || requestedPath === '.\\'
      || /^\/+$/.test(requestedPath)
    ) {
      throw new Error('search requires a vault-relative path to one Markdown note or a non-root folder. Vault-wide search is not allowed.');
    }
    const scopePath = requestedPath.replace(/\/+$/, '');
    const needle = textQuery.toLowerCase();
    const hits: VaultSearchHit[] = [];
    const files = this.resolveSearchFiles(scopePath);
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

      if (tagFilter) {
        const cache = this.app.metadataCache.getFileCache(file);
        const tags = cache ? getAllTags(cache) : null;
        if (!tags?.some((t) => t === tagFilter || t === `#${tagFilter}`)) {
          continue;
        }
      }

      if (!needle) {
        if (takeHit({ path: file.path })) {
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
        if (takeHit(hit)) {
          return hits;
        }
      }
    }

    return hits;
  }

  async getNoteInfo(file?: string, path?: string): Promise<VaultNoteInfo> {
    const resolved = this.resolveFile(file, path);
    if (!resolved) {
      throw new Error('Note not found.');
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

  /** List tags in the vault, or in one note when file/path/active is set. */
  getTags(sort: 'name' | 'count' = 'name', scope?: {
    file?: string;
    path?: string;
    active?: boolean;
  }): VaultTagEntry[] {
    const counts = new Map<string, number>();
    for (const file of this.resolveTagFiles(scope)) {
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
      throw new Error('Note not found.');
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

function joinNoteContent(
  existing: string,
  addition: string,
  inline: boolean,
  mode: 'append' | 'prepend',
): string {
  if (addition.length === 0) {
    return existing;
  }
  if (existing.length === 0) {
    return addition;
  }
  if (inline) {
    return mode === 'append' ? `${existing}${addition}` : `${addition}${existing}`;
  }
  if (mode === 'append') {
    const separator = existing.endsWith('\n') ? '' : '\n';
    return `${existing}${separator}${addition}`;
  }
  const separator = addition.endsWith('\n') ? '' : '\n';
  return `${addition}${separator}${existing}`;
}

function prependAfterFrontmatter(existing: string, addition: string, inline: boolean): string {
  const split = splitFrontmatter(existing);
  const joined = joinNoteContent(split.body, addition, inline, 'prepend');
  if (!split.frontmatter) {
    return joined;
  }
  if (inline || joined.length === 0 || split.frontmatter.endsWith('\n') || joined.startsWith('\n')) {
    return `${split.frontmatter}${joined}`;
  }
  return `${split.frontmatter}\n${joined}`;
}

function splitFrontmatter(content: string): { frontmatter: string | null; body: string } {
  if (!content.startsWith('---')) {
    return { frontmatter: null, body: content };
  }
  const afterOpen = content.startsWith('---\n')
    ? 4
    : content.startsWith('---\r\n')
      ? 5
      : -1;
  if (afterOpen < 0) {
    return { frontmatter: null, body: content };
  }
  const closeLf = content.indexOf('\n---', afterOpen);
  if (closeLf < 0) {
    return { frontmatter: null, body: content };
  }
  const afterClose = closeLf + 4;
  if (content.startsWith('\r\n', afterClose)) {
    return { frontmatter: content.slice(0, afterClose + 2), body: content.slice(afterClose + 2) };
  }
  if (content.startsWith('\n', afterClose)) {
    return { frontmatter: content.slice(0, afterClose + 1), body: content.slice(afterClose + 1) };
  }
  if (afterClose === content.length) {
    return { frontmatter: content, body: '' };
  }
  return { frontmatter: null, body: content };
}

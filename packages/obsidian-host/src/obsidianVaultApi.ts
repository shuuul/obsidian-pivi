import {
  type App,
  MarkdownView,
  parseFrontMatterAliases,
  type TAbstractFile,
  TFile,
  TFolder,
} from 'obsidian';

import { captureFileRecoverySnapshot } from './fileRecoverySnapshot';
import { joinNoteContent, prependAfterFrontmatter } from './noteContentJoin';
import {
  type AgentManagedPathMutationMode,
  getVaultPath,
  normalizePathForVault,
  requireAgentVaultMutationPath,
} from './path';
import type {
  VaultAliasEntry,
  VaultAttachmentInfo,
  VaultBaseFile,
  VaultBaseView,
  VaultDeleteResult,
  VaultGraphResult,
  VaultLinkEntry,
  VaultNoteInfo,
  VaultPathEntry,
  VaultPropertyIndexEntry,
  VaultRecentFile,
  VaultSearchHit,
  VaultTagEntry,
  VaultWriteAttachmentResult,
} from './vaultApiTypes';
import { applyVaultEdits, type VaultEditItem } from './vaultEditMatch';
import {
  collectBacklinks,
  collectOutgoingLinks,
  collectTags,
  describeAttachment,
  describeNote,
  getBaseFiles,
  getGraphAnalysis,
  getRecentFiles,
  getTagInfo,
  getVaultAliasIndex,
  getVaultPropertyIndex,
  listFolderEntries,
  parseBaseViews,
  resolveBaseFile,
} from './vaultMetadataQueries';
import { searchVaultNotes, type VaultSearchParams } from './vaultSearch';

export type {
  VaultAliasEntry,
  VaultAttachmentInfo,
  VaultBaseFile,
  VaultBaseView,
  VaultDeleteResult,
  VaultGraphResult,
  VaultLinkEntry,
  VaultNoteInfo,
  VaultPathEntry,
  VaultPropertyIndexEntry,
  VaultRecentFile,
  VaultSearchHit,
  VaultTagEntry,
  VaultWriteAttachmentResult,
} from './vaultApiTypes';

export class ObsidianVaultApi {
  private readonly cliMutationTails = new Map<string, Promise<void>>();

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

  prepareActiveNoteInsertion(): { path: string; title: string; insert: (content: string) => Promise<void> } {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    const file = view?.file;
    if (!view || !file || file.extension !== 'md') {
      throw new Error('No active Markdown editor.');
    }
    const path = this.requireMutationPath(file.path);
    const editor = view.editor;
    const original = editor.getValue();
    const selections = JSON.stringify(editor.listSelections());
    const requireUnchangedEditor = (): void => {
      if (this.app.workspace.getActiveViewOfType(MarkdownView) !== view
        || view.file !== file || file.path !== path || view.editor !== editor
        || editor.getValue() !== original || JSON.stringify(editor.listSelections()) !== selections) {
        throw new Error('The target editor changed while preparing insertion. Retry on the intended note.');
      }
      this.requireMutationPath(file.path);
    };
    return {
      path,
      title: file.basename,
      async insert(content) {
        requireUnchangedEditor();
        // Capture unsaved editor content, not an older on-disk copy. No await
        // may separate the final identity check from the bound editor write.
        await captureFileRecoverySnapshot(view.app, file, original);
        requireUnchangedEditor();
        editor.replaceSelection(content);
      },
    };
  }

  /**
   * Validate, snapshot, and serialize an out-of-process mutation for one exact
   * path. Unsaved active-editor content blocks the CLI rather than being lost.
   */
  async runCliMutation<T>(path: string, mutate: () => Promise<T>): Promise<T> {
    const normalized = this.requireMutationPath(path);
    const previous = this.cliMutationTails.get(normalized) ?? Promise.resolve();
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    const tail = previous.catch(() => undefined).then(() => pending);
    this.cliMutationTails.set(normalized, tail);

    await previous.catch(() => undefined);
    try {
      const current = this.app.vault.getAbstractFileByPath(normalized);
      if (current && !(current instanceof TFile)) {
        throw new Error(`Vault path is not a file: ${path}`);
      }
      if (current) {
        const view = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (view?.file === current) {
          const editorContent = view.editor.getValue();
          const storedContent = await this.app.vault.cachedRead(current);
          if (editorContent !== storedContent) {
            throw new Error(
              `Cannot modify ${normalized} through Obsidian CLI while its active editor has unsaved changes. Save the note and retry.`,
            );
          }
          await captureFileRecoverySnapshot(this.app, current, editorContent);
          if (this.app.workspace.getActiveViewOfType(MarkdownView) !== view
            || view.file !== current || view.editor.getValue() !== editorContent) {
            throw new Error(`The target editor changed while preparing the CLI mutation for ${normalized}. Retry.`);
          }
        } else {
          await this.capturePreWriteSnapshot(current);
        }
      }
      return await mutate();
    } finally {
      release();
      if (this.cliMutationTails.get(normalized) === tail) {
        this.cliMutationTails.delete(normalized);
      }
    }
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
    return listFolderEntries(target);
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
      return getVaultPropertyIndex(this.app, name, options?.sort ?? 'name');
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

    const aliases = getVaultAliasIndex(this.app, options?.verbose === true);
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
      return describeAttachment(this.app, target, params.sourcePath);
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
    return describeAttachment(this.app, file, params.sourcePath);
  }

  getVaultName(): string {
    const named = this.app.vault.getName?.();
    if (typeof named === 'string' && named.length > 0) {
      return named;
    }
    const base = getVaultPath(this.app);
    return base ? base.split('/').filter(Boolean).pop() ?? 'vault' : 'vault';
  }

  /** In-process vault search (no CLI). Literal substring plus tag:. Listing queries error toward `ls`. */
  async searchNotes(params: VaultSearchParams): Promise<VaultSearchHit[]> {
    return searchVaultNotes(this.app, this.vaultPath(), params);
  }

  async getNoteInfo(file?: string, path?: string): Promise<VaultNoteInfo> {
    const resolved = this.resolveFile(file, path);
    if (!resolved) {
      throw new Error('Note not found.');
    }
    return describeNote(this.app, resolved);
  }

  /** List Bases config files in the vault using the public vault API. */
  getBaseFiles(): VaultBaseFile[] {
    return getBaseFiles(this.app);
  }

  /** Read configured Bases views from a `.base` file without relying on active-file CLI state. */
  async getBaseViews(file?: string, path?: string): Promise<{ path: string; views: VaultBaseView[] }> {
    const resolved = resolveBaseFile(this.app, this.vaultPath(), file, path);
    if (!resolved) {
      throw new Error('Base file not found. Provide file= or path= for a .base file.');
    }
    const content = await this.app.vault.cachedRead(resolved);
    return { path: resolved.path, views: parseBaseViews(content, resolved.path) };
  }

  /** List tags in the vault, or in one note when file/path/active is set. */
  getTags(sort: 'name' | 'count' = 'name', scope?: {
    file?: string;
    path?: string;
    active?: boolean;
  }): VaultTagEntry[] {
    return collectTags(this.app, this.resolveTagFiles(scope), sort);
  }

  /** Get details for a single tag: count and list of files containing it. */
  getTagInfo(tag: string, verbose?: boolean): { name: string; count: number; files?: string[] } {
    return getTagInfo(this.app, tag, verbose);
  }

  /** Graph analysis: orphans (no backlinks), deadends (no outgoing links), and unresolved wikilinks. */
  getGraphAnalysis(
    actions: ('orphans' | 'deadends' | 'unresolved')[],
    options?: { includeNonMarkdown?: boolean; limit?: number },
  ): VaultGraphResult {
    return getGraphAnalysis(this.app, actions, options);
  }

  /** List recently opened files. */
  getRecentFiles(limit?: number): VaultRecentFile[] {
    return getRecentFiles(this.app, limit);
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
    return {
      path: resolved.path,
      links: direction === 'backlinks'
        ? collectBacklinks(this.app, resolved.path)
        : collectOutgoingLinks(this.app, resolved),
    };
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

import {
  type App,
  getAllTags,
  parseFrontMatterAliases,
  type TAbstractFile,
  TFile,
  TFolder,
} from 'obsidian';

import {
  type AgentManagedPathMutationMode,
  assertAgentManagedPathMutationAllowed,
} from '../managedAgentVaultPaths';
import { replaceVaultEditMatch } from '../vaultEditMatch';

export { assertAgentManagedPathMutationAllowed } from '../managedAgentVaultPaths';
const MAX_TEXT_BYTES = 10_000_000;
const MAX_ATTACHMENT_BYTES = 25_000_000;

export type MobileRecoveryCapability = { available: false; reason: 'public-api-unavailable' };

/** Browser-only lexical validator for canonical vault-relative Agent mutation paths. */
export function requireMobileAgentVaultMutationPath(
  rawPath: string,
  mode: AgentManagedPathMutationMode = 'direct',
): string {
  const raw = rawPath.trim().replaceAll('\\', '/');
  if (!raw || raw.includes('\0') || raw.startsWith('/') || raw.startsWith('//') || /^[a-zA-Z]:/.test(raw)) {
    throw new Error(`Unsafe vault mutation path: ${rawPath}`);
  }
  const segments = raw.split('/');
  if (segments.some(segment => segment === '' || segment === '.' || segment === '..')) {
    throw new Error(`Vault traversal is not allowed: ${rawPath}`);
  }
  const normalized = segments.join('/');
  assertAgentManagedPathMutationAllowed(normalized, { mode });
  return normalized;
}

export class MobileObsidianVaultApi {
  readonly recoveryCapability: MobileRecoveryCapability = {
    available: false,
    reason: 'public-api-unavailable',
  };

  constructor(private readonly app: App) {}

  private asFile(value: TAbstractFile | null): TFile | null { return value instanceof TFile ? value : null; }
  private resolve(file?: string, path?: string): TFile | null {
    if (path?.trim()) return this.asFile(this.app.vault.getAbstractFileByPath(path.trim().replaceAll('\\', '/')));
    if (file?.trim()) return this.app.metadataCache.getFirstLinkpathDest(file.trim(), '') ?? null;
    return this.app.workspace.getActiveFile();
  }
  private requireFile(file?: string, path?: string): TFile {
    const result = this.resolve(file, path);
    if (!result) throw new Error('Note not found. Provide file= or path=.');
    return result;
  }
  private mutationFile(file?: string, path?: string, mode: 'direct' | 'recursive' = 'direct'): TFile {
    const result = this.requireFile(file, path);
    requireMobileAgentVaultMutationPath(result.path, mode);
    return result;
  }
  private checkText(content: string): void {
    if (new TextEncoder().encode(content).byteLength > MAX_TEXT_BYTES) throw new Error('Vault text exceeds the 10000000-byte Mobile budget.');
  }

  async readNote(file?: string, path?: string) { const found = this.requireFile(file, path); return { path: found.path, content: await this.app.vault.read(found) }; }
  async editNote(params: { file?: string; path?: string; old_string: string; new_string: string; replace_all?: boolean }) {
    const found = this.mutationFile(params.file, params.path); let replacements = 0;
    await this.app.vault.process(found, content => {
      const result = replaceVaultEditMatch({ filePath: found.path, content, oldString: params.old_string, newString: params.new_string, replaceAll: Boolean(params.replace_all) });
      this.checkText(result.content); replacements = result.replacements; return result.content;
    });
    return { path: found.path, replacements };
  }
  async writeNote(params: { file?: string; path?: string; content: string; mode: 'create' | 'overwrite' | 'append' | 'prepend'; overwrite?: boolean }) {
    this.checkText(params.content);
    if (params.mode === 'append' || params.mode === 'prepend') {
      const found = this.mutationFile(params.file, params.path);
      await this.app.vault.process(found, old => { const next = params.mode === 'append' ? old + params.content : params.content + old; this.checkText(next); return next; });
      return { path: found.path };
    }
    const candidate = params.path?.trim() || (params.file?.trim() ? `${params.file.trim().replace(/\.md$/, '')}.md` : '');
    const target = requireMobileAgentVaultMutationPath(candidate);
    const existing = this.asFile(this.app.vault.getAbstractFileByPath(target));
    if (existing && params.mode === 'create' && !params.overwrite) throw new Error(`File already exists: ${target}`);
    if (existing) await this.app.vault.process(existing, () => params.content); else await this.app.vault.create(target, params.content);
    return { path: target };
  }
  async movePath(params: { path: string; newPath: string }) { const item = this.app.vault.getAbstractFileByPath(requireMobileAgentVaultMutationPath(params.path, 'recursive')); if (!item) throw new Error(`Vault path not found: ${params.path}`); const newPath = requireMobileAgentVaultMutationPath(params.newPath); await this.app.fileManager.renameFile(item, newPath); return { path: params.path, newPath }; }
  async trashPath(params: { file?: string; path?: string }) { const item = params.path ? this.app.vault.getAbstractFileByPath(requireMobileAgentVaultMutationPath(params.path, 'recursive')) : this.mutationFile(params.file, undefined, 'recursive'); if (!item) throw new Error('File or folder not found.'); await this.app.fileManager.trashFile(item); return { path: item.path, kind: item instanceof TFolder ? 'folder' as const : 'file' as const }; }
  async createFolder(path: string) { const normalized = requireMobileAgentVaultMutationPath(path, 'recursive'); await this.app.vault.createFolder(normalized); return { path: normalized }; }
  listPath(path = '') { const target = path ? this.app.vault.getAbstractFileByPath(path.replaceAll('\\', '/')) : this.app.vault.getRoot(); if (!(target instanceof TFolder)) throw new Error(`Vault path is not a folder: ${path}`); return target.children.map(item => { if (item instanceof TFolder) return { path: item.path, kind: 'folder' as const, name: item.name }; if (!(item instanceof TFile)) throw new Error(`Unexpected vault entry: ${item.path}`); return { path: item.path, kind: 'file' as const, name: item.name, extension: item.extension, size: item.stat.size }; }); }
  getProperties(file?: string, path?: string, name?: string) { if (!file && !path) { const names = new Set<string>(); for (const note of this.app.vault.getMarkdownFiles()) Object.keys(this.app.metadataCache.getFileCache(note)?.frontmatter ?? {}).forEach(key => names.add(key)); return { properties: [...names].sort() }; } const found = this.requireFile(file, path); const properties = (this.app.metadataCache.getFileCache(found)?.frontmatter ?? {}) as Record<string, unknown>; return { path: found.path, properties, ...(name ? { value: properties[name] } : {}) }; }
  async setProperty(file: string | undefined, path: string | undefined, name: string, value: string) { const found = this.mutationFile(file, path); await this.app.fileManager.processFrontMatter(found, (data: Record<string, unknown>) => { data[name] = value; }); return { path: found.path, name }; }
  async removeProperty(file: string | undefined, path: string | undefined, name: string) { const found = this.mutationFile(file, path); await this.app.fileManager.processFrontMatter(found, (data: Record<string, unknown>) => { delete data[name]; }); return { path: found.path, name }; }
  async getAttachmentInfo(params: { path?: string; filename?: string; sourcePath?: string }) { if (params.path) { const found = this.requireFile(undefined, params.path); return { path: found.path, markdown: this.app.fileManager.generateMarkdownLink(found, params.sourcePath ?? ''), resourcePath: this.app.vault.getResourcePath(found), size: found.stat.size, extension: found.extension }; } if (!params.filename) throw new Error('filename= or path= is required.'); const availablePath = await this.app.fileManager.getAvailablePathForAttachment(params.filename, params.sourcePath); requireMobileAgentVaultMutationPath(availablePath); return { availablePath }; }
  async writeAttachment(params: { filename: string; data: ArrayBuffer; sourcePath?: string }) { if (params.data.byteLength > MAX_ATTACHMENT_BYTES) throw new Error('Attachment exceeds the 25000000-byte Mobile budget.'); const available = await this.app.fileManager.getAvailablePathForAttachment(params.filename, params.sourcePath); const path = requireMobileAgentVaultMutationPath(available); const file = await this.app.vault.createBinary(path, params.data); return { path, markdown: this.app.fileManager.generateMarkdownLink(file, params.sourcePath ?? ''), resourcePath: this.app.vault.getResourcePath(file), size: file.stat.size, extension: file.extension }; }
  async searchNotes(params: { query: string; path?: string; limit?: number; context?: boolean }) {
    const hits: Array<{ path: string; line?: number; matches?: string[] }> = [];
    const limit = params.limit ?? 50;
    const query = params.query.trim();
    const folder = (query.startsWith('path:') ? query.slice(5) : params.path ?? '').replace(/\/$/, '');
    const tag = query.startsWith('tag:') ? query.slice(4).replace(/^#/, '') : '';
    const needle = ['*', '**', ''].includes(query) || tag || query.startsWith('path:')
      ? ''
      : query.toLowerCase();
    for (const note of this.app.vault.getMarkdownFiles()) {
      if (folder && note.path !== folder && !note.path.startsWith(`${folder}/`)) continue;
      if (tag && !(getAllTags(this.app.metadataCache.getFileCache(note) ?? {}) ?? [])
        .some(value => value.replace(/^#/, '') === tag)) continue;
      if (!needle) {
        hits.push({ path: note.path });
      } else {
        const lines = (await this.app.vault.cachedRead(note)).split('\n');
        for (let index = 0; index < lines.length; index++) {
          if (!lines[index]?.toLowerCase().includes(needle)) continue;
          hits.push({
            path: note.path,
            line: index + 1,
            ...(params.context
              ? { matches: lines.slice(Math.max(0, index - 2), index + 3) }
              : {}),
          });
          if (hits.length >= limit) return hits;
        }
      }
      if (hits.length >= limit) return hits;
    }
    return hits;
  }
  async getNoteInfo(file?: string, path?: string) { const found = this.requireFile(file, path); const cache = this.app.metadataCache.getFileCache(found); const content = await this.app.vault.cachedRead(found); return { path: found.path, basename: found.basename, extension: found.extension, size: found.stat.size, ctime: found.stat.ctime, mtime: found.stat.mtime, tags: getAllTags(cache ?? {}) ?? [], links: this.outgoing(found), frontmatter: cache?.frontmatter ?? null, wordCount: content.trim().split(/\s+/).filter(Boolean).length, characterCount: content.length, aliases: parseFrontMatterAliases(cache?.frontmatter ?? null) ?? [] }; }
  getRecentFiles(limit = 20) { return this.app.workspace.getLastOpenFiles().slice(0, limit).map(path => { const file = this.asFile(this.app.vault.getAbstractFileByPath(path)); return { path, basename: file?.basename ?? path.split('/').pop() ?? path, mtime: file?.stat.mtime ?? null }; }); }
  getTags(sort: 'name' | 'count' = 'name') { const counts = new Map<string, number>(); for (const file of this.app.vault.getMarkdownFiles()) for (const tag of getAllTags(this.app.metadataCache.getFileCache(file) ?? {}) ?? []) { const name = tag.replace(/^#/, ''); counts.set(name, (counts.get(name) ?? 0) + 1); } return [...counts].map(([name, count]) => ({ name, count })).sort((a, b) => sort === 'count' ? b.count - a.count || a.name.localeCompare(b.name) : a.name.localeCompare(b.name)); }
  getTagInfo(tag: string, verbose = false) { const name = tag.replace(/^#/, '').trim(); const files = this.app.vault.getMarkdownFiles().filter(file => (getAllTags(this.app.metadataCache.getFileCache(file) ?? {}) ?? []).some(value => value.replace(/^#/, '') === name)).map(file => file.path); return { name, count: files.length, ...(verbose ? { files } : {}) }; }
  getGraphAnalysis(actions: Array<'orphans' | 'deadends' | 'unresolved'>, options?: { includeNonMarkdown?: boolean; limit?: number }) { const limit = options?.limit ?? 200; const files = options?.includeNonMarkdown ? this.app.vault.getFiles() : this.app.vault.getMarkdownFiles(); const linked = new Set(Object.values(this.app.metadataCache.resolvedLinks).flatMap(value => Object.keys(value))); const orphans = actions.includes('orphans') ? files.map(file => file.path).filter(path => !linked.has(path)).sort().slice(0, limit) : []; const deadends = actions.includes('deadends') ? files.filter(file => !(this.app.metadataCache.getFileCache(file)?.links?.length)).map(file => file.path).sort().slice(0, limit) : []; const unresolved = actions.includes('unresolved') ? Object.entries(this.app.metadataCache.unresolvedLinks).flatMap(([source, targets]) => Object.entries(targets).map(([target, count]) => ({ source, target, count }))).slice(0, limit) : []; return { orphans, deadends, unresolved }; }
  getLinks(file?: string, path?: string, direction: 'outgoing' | 'backlinks' = 'outgoing') { const found = this.requireFile(file, path); if (direction === 'backlinks') { const links = Object.entries(this.app.metadataCache.resolvedLinks).filter(([, targets]) => targets[found.path]).map(([source, targets]) => ({ path: source, count: targets[found.path] ?? 0 })); return { path: found.path, links }; } return { path: found.path, links: this.outgoing(found).map(path => ({ path, count: 1 })) }; }
  private outgoing(file: TFile) { return [...new Set((this.app.metadataCache.getFileCache(file)?.links ?? []).map(link => this.app.metadataCache.getFirstLinkpathDest(link.link, file.path)?.path ?? link.link))]; }
}

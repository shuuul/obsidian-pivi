import type { App, TAbstractFile, TFile } from 'obsidian';

import { getVaultPath, normalizePathForVault } from '../../utils/path';

export class ObsidianVaultApi {
  constructor(private readonly app: App) {}

  private vaultPath(): string | null {
    return getVaultPath(this.app);
  }

  private asFile(abstract: TAbstractFile | null): TFile | null {
    return abstract && 'extension' in abstract ? (abstract as TFile) : null;
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
}

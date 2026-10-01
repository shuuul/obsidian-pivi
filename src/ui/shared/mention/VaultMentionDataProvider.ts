import type { App, TFile } from 'obsidian';

import { VaultFileCache, VaultFolderCache } from './VaultMentionCache';

export class VaultMentionDataProvider {
  private fileCache: VaultFileCache;
  private folderCache: VaultFolderCache;

  constructor(app: App) {
    this.fileCache = new VaultFileCache(app);
    this.folderCache = new VaultFolderCache(app);
  }

  initializeInBackground(): void {
    this.fileCache.initializeInBackground();
    this.folderCache.initializeInBackground();
  }

  markFilesDirty(): void {
    this.fileCache.markDirty();
  }

  markFoldersDirty(): void {
    this.folderCache.markDirty();
  }

  getCachedVaultFiles(): TFile[] {
    return this.fileCache.getFiles();
  }

  getCachedVaultFolders(): Array<{ name: string; path: string }> {
    return this.folderCache.getFolders().map(folder => ({
      name: folder.name,
      path: folder.path,
    }));
  }
}

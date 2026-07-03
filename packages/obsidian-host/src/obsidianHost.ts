import type { FileStore, HomeFileStore } from './fileStore';
import type { ObsidianVaultApi } from './obsidianVaultApi';
import type { SharedStorageService } from './storage/sharedStorageService';

export interface ObsidianHost {
  vaultApi: ObsidianVaultApi;
  vaultFileStore: FileStore;
  homeFileStore?: HomeFileStore;
  sharedStorage?: SharedStorageService;
  secretStore?: unknown;
  vaultPath: string | null;
  vaultName: string;
}

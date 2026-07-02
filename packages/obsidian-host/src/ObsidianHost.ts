import type { FileStore, HomeFileStore } from './FileStore';
import type { ObsidianVaultApi } from './ObsidianVaultApi';
import type { SharedStorageService } from './storage/SharedStorageService';

export interface ObsidianHost {
  vaultApi: ObsidianVaultApi;
  vaultFileStore: FileStore;
  homeFileStore?: HomeFileStore;
  sharedStorage?: SharedStorageService;
  secretStore?: unknown;
  vaultPath: string | null;
  vaultName: string;
}

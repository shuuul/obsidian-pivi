import type { ObsidianToolsSettings } from '../../../pi/types/settings';
import type { ObsidianCliTransport } from '../ObsidianCliTransport';
import type { ObsidianVaultApi } from '../ObsidianVaultApi';
import type { ObsidianApprovalFn } from './approval';

export interface ObsidianToolDeps {
  vault: ObsidianVaultApi;
  cli: ObsidianCliTransport;
  settings: ObsidianToolsSettings;
  vaultName: string;
  approve: ObsidianApprovalFn | null;
}

import type { ObsidianCliTransport, ObsidianVaultApi } from '@pivi/obsidian-host';
import type { ObsidianToolsSettings } from '@pivi/pivi-agent-core/foundation';

import type { ObsidianApprovalFn } from './approval';

export interface ObsidianToolDeps {
  vault: ObsidianVaultApi;
  cli: ObsidianCliTransport;
  settings: ObsidianToolsSettings;
  vaultName: string;
  approve: ObsidianApprovalFn | null;
}

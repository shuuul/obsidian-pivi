import type { PiviNetworkClients } from '@pivi/obsidian-host/createPiviNetworkClients';
import type { PiviSettings } from '@pivi/pivi-agent-core/foundation';
import type { FileStore } from '@pivi/pivi-agent-core/ports';
import type { SessionRecoveryPort } from '@pivi/pivi-agent-core/session';
import type { SlashCatalogEntry } from '@pivi/pivi-agent-core/skills/commands/slashCommandEntry';
import type { App, Plugin } from 'obsidian';

import type { PiviPlatformCapabilities } from '@/app/platformCapabilities';

/** Obsidian lifecycle capabilities required while constructing app-owned services. */
export interface PiviWorkspaceHost {
  app: App;
  settings: PiviSettings;
  platformCapabilities: PiviPlatformCapabilities;
  saveSettings(): Promise<void>;
  reconcileWorkspaceCommandEntries(entries: readonly SlashCatalogEntry[]): void;
  sessionRecovery: SessionRecoveryPort;
  /**
   * Same-turn refresh after a durable management commit.
   * Implementations must not roll back persistence when a view refresh fails.
   * Returns bounded sanitized per-target failures (never throws for partial refresh).
   */
  refreshPiviManagement?(
    domain: 'mcp' | 'skills' | 'commands',
  ): Promise<readonly { readonly target: string; readonly message: string }[]>;
}

export interface WorkspaceInitContext {
  owner: Plugin;
  host: PiviWorkspaceHost;
  vaultAdapter: FileStore;
  network: PiviNetworkClients;
}

import type { FileStore } from '@pivi/agent/ports';
import type { SessionRecoveryPort } from '@pivi/agent/session';
import type { PiviSettings } from '@pivi/agent/settings';
import type { SlashCatalogEntry } from '@pivi/agent/skills/commands/slashCommandEntry';
import type { PiviNetworkClients } from '@pivi/obsidian-host/createPiviNetworkClients';
import type { App, EventRef } from 'obsidian';

/** Obsidian lifecycle capabilities required while constructing app-owned services. */
export interface PiviWorkspaceHost {
  app: App;
  settings: PiviSettings;
  registerEvent(eventRef: EventRef): void;
  saveSettings(): Promise<void>;
  reconcileWorkspaceCommandEntries(entries: readonly SlashCatalogEntry[]): void;
  sessionRecovery: SessionRecoveryPort;
  /**
   * Same-turn refresh after a durable management commit.
   * Implementations must not roll back persistence when a view refresh fails.
   * Returns bounded sanitized per-target failures (never throws for partial refresh).
   */
  refreshPiviManagement?(
    domain: 'mcp' | 'skills' | 'commands' | 'prompt',
  ): Promise<readonly { readonly target: string; readonly message: string }[]>;
}

export interface WorkspaceInitContext {
  host: PiviWorkspaceHost;
  vaultAdapter: FileStore;
  network: PiviNetworkClients;
}

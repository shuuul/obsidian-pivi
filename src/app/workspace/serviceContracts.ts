import type { PiviNetworkClients } from '@pivi/obsidian-host/createPiviNetworkClients';
import type { PiviSettings } from '@pivi/pivi-agent-core/foundation';
import type { FileStore } from '@pivi/pivi-agent-core/ports';
import type { SlashCatalogEntry } from '@pivi/pivi-agent-core/skills/commands/slashCommandEntry';
import type { App, EventRef } from 'obsidian';

/** Obsidian lifecycle capabilities required while constructing app-owned services. */
export interface PiviWorkspaceHost {
  app: App;
  settings: PiviSettings;
  registerEvent(eventRef: EventRef): void;
  saveSettings(): Promise<void>;
  reconcileWorkspaceCommandEntries(entries: readonly SlashCatalogEntry[]): void;
}

export interface WorkspaceInitContext {
  host: PiviWorkspaceHost;
  vaultAdapter: FileStore;
  network: PiviNetworkClients;
}

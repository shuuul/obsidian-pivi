import type { SlashCatalogEntry } from '@pivi/agent/skills/commands/slashCommandEntry';

export interface SettingsCommandsPort {
  refresh(): Promise<void>;
  listIconNames(): readonly string[];
  loadWorkspaceCatalog(): Promise<{
    readonly entries: readonly SlashCatalogEntry[];
    readonly catalogRevision: number;
  }>;
  listDropdownEntries(): Promise<readonly SlashCatalogEntry[]>;
  saveWorkspaceEntry(entry: SlashCatalogEntry, catalogRevision: number): Promise<SlashCatalogEntry>;
  renameWorkspaceEntry(previous: SlashCatalogEntry, entry: SlashCatalogEntry, catalogRevision: number): Promise<SlashCatalogEntry>;
  saveWorkspaceOrder(ids: readonly string[], catalogRevision: number): Promise<void>;
  deleteWorkspaceEntry(entry: SlashCatalogEntry, catalogRevision: number): Promise<{
    saved: true;
    refreshed: boolean;
    warnings?: string[];
  }>;
}

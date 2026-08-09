import type { SlashCommand } from '../../foundation';
import type { SlashCatalogEntry } from './slashCommandEntry';

export interface SlashCommandDropdownConfig {
  triggerChars: string[];
  builtInPrefix: string;
  skillPrefix: string;
  commandPrefix: string;
}

export interface SlashCommandCatalog {
  listDropdownEntries(context: { includeBuiltIns: boolean }): Promise<SlashCatalogEntry[]>;
  listWorkspaceEntries(): Promise<SlashCatalogEntry[]>;
  getWorkspaceSnapshot(): Promise<{
    readonly entries: readonly SlashCatalogEntry[];
    readonly catalogRevision: number;
  }>;
  saveWorkspaceEntry(entry: SlashCatalogEntry, catalogRevision: number): Promise<void>;
  renameWorkspaceEntry(previous: SlashCatalogEntry, entry: SlashCatalogEntry, catalogRevision: number): Promise<void>;
  saveWorkspaceOrder(ids: readonly string[], catalogRevision: number): Promise<void>;
  deleteWorkspaceEntry(entry: SlashCatalogEntry, catalogRevision: number): Promise<{
    saved: true;
    refreshed: boolean;
    warnings?: string[];
  }>;
  setRuntimeCommands(commands: SlashCommand[]): void;
  getDropdownConfig(): SlashCommandDropdownConfig;
  refresh(): Promise<void>;
}

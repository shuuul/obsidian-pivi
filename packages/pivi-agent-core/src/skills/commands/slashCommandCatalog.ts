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
  saveWorkspaceEntry(entry: SlashCatalogEntry): Promise<void>;
  deleteWorkspaceEntry(entry: SlashCatalogEntry): Promise<void>;
  setRuntimeCommands(commands: SlashCommand[]): void;
  getDropdownConfig(): SlashCommandDropdownConfig;
  refresh(): Promise<void>;
}

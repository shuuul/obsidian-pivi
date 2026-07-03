import type { SlashCommand } from '@pivi/pivi-agent-core/foundation';

import type { SlashCatalogEntry } from './SlashCommandEntry';

export interface SlashCommandDropdownConfig {
  triggerChars: string[];
  builtInPrefix: string;
  skillPrefix: string;
  commandPrefix: string;
}

export interface SlashCommandCatalog {
  listDropdownEntries(context: { includeBuiltIns: boolean }): Promise<SlashCatalogEntry[]>;
  listVaultEntries(): Promise<SlashCatalogEntry[]>;
  saveVaultEntry(entry: SlashCatalogEntry): Promise<void>;
  deleteVaultEntry(entry: SlashCatalogEntry): Promise<void>;
  setRuntimeCommands(commands: SlashCommand[]): void;
  getDropdownConfig(): SlashCommandDropdownConfig;
  refresh(): Promise<void>;
}

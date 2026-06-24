import type { SlashCommandDropdownConfig } from '../../../core/agent/commands/SlashCommandCatalog';
import type { SlashCatalogEntry } from '../../../core/agent/commands/SlashCommandEntry';
import type { OpenSessionState } from '../../../core/types';
import type ObsiusPlugin from '../../../main';
import { getTabHiddenCommands } from './tabAgentContext';
import type { TabData } from './types';

export type SlashCatalogInfo = {
  config: SlashCommandDropdownConfig;
  getEntries: () => Promise<SlashCatalogEntry[]>;
} | null;

export function syncSlashCommandDropdown(
  tab: TabData,
  plugin: ObsiusPlugin,
  getSlashCatalogConfig?: () => SlashCatalogInfo,
  openSession?: OpenSessionState | null,
): void {
  const dropdown = tab.ui.slashCommandDropdown;
  if (!dropdown) {
    return;
  }

  const catalogInfo = getSlashCatalogConfig?.();

  if (catalogInfo) {
    dropdown.setSlashCatalog?.(catalogInfo.config, catalogInfo.getEntries);
  } else {
    dropdown.resetRuntimeSkillsCache();
  }

  dropdown.setHiddenCommands(getTabHiddenCommands(tab, plugin, openSession));
}

import type PiviPlugin from '../../../main';
import type { SlashCommandDropdownConfig } from '../../../pi/agent/commands/SlashCommandCatalog';
import type { SlashCatalogEntry } from '../../../pi/agent/commands/SlashCommandEntry';
import type { OpenSessionState } from '../../../pi/types';
import { getTabHiddenCommands } from './tabAgentContext';
import type { TabData } from './types';

export type SlashCatalogInfo = {
  config: SlashCommandDropdownConfig;
  getEntries: () => Promise<SlashCatalogEntry[]>;
} | null;

export function syncSlashCommandDropdown(
  tab: TabData,
  plugin: PiviPlugin,
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

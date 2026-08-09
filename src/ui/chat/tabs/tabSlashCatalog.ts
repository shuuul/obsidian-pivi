import type { OpenSessionState } from '@pivi/agent/foundation';
import type { ChatSettingsPort } from '@pivi/agent/runtime/chatPorts';
import type { SlashCommandDropdownConfig } from '@pivi/agent/skills/commands/slashCommandCatalog';
import type { SlashCatalogEntry } from '@pivi/agent/skills/commands/slashCommandEntry';

import { getTabHiddenCommands } from './tabAgentContext';
import type { TabData } from './types';

export type SlashCatalogInfo = {
  config: SlashCommandDropdownConfig;
  getEntries: () => Promise<SlashCatalogEntry[]>;
} | null;

export function syncSlashCommandDropdown(
  tab: TabData,
  settings: ChatSettingsPort,
  getSlashCatalogConfig?: () => SlashCatalogInfo,
  openSession?: OpenSessionState | null,
): void {
  const dropdown = tab.ui.slashCommandDropdown;
  if (!dropdown) {
    return;
  }

  const catalogInfo = getSlashCatalogConfig?.();

  if (catalogInfo) {
    dropdown.setSlashCatalog(catalogInfo.config, catalogInfo.getEntries);
  } else {
    dropdown.resetRuntimeSkillsCache();
  }

  dropdown.setHiddenCommands(getTabHiddenCommands(tab, settings, openSession));
}

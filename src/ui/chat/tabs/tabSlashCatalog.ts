import type { OpenSessionState } from '@pivi/pivi-agent-core/foundation';
import type { SlashCommandDropdownConfig } from '@pivi/pivi-agent-core/skills/commands/slashCommandCatalog';
import type { SlashCatalogEntry } from '@pivi/pivi-agent-core/skills/commands/slashCommandEntry';

import type { PiviChatHost } from '@/app/hostContracts';

import { getTabHiddenCommands } from './tabAgentContext';
import type { TabData } from './types';

export type SlashCatalogInfo = {
  config: SlashCommandDropdownConfig;
  getEntries: () => Promise<SlashCatalogEntry[]>;
} | null;

export function syncSlashCommandDropdown(
  tab: TabData,
  plugin: PiviChatHost,
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

import type { ChatPorts } from '@pivi/pivi-agent-core/runtime/chatPorts';
import type { SlashCommandDropdownConfig } from "@pivi/pivi-agent-core/skills/commands/slashCommandCatalog";
import type { SlashCatalogEntry } from "@pivi/pivi-agent-core/skills/commands/slashCommandEntry";

import { SlashCommandDropdown } from "@/ui/shared/components/SlashCommandDropdown";

import {
  createDropdownMcpServerProvider,
  createDropdownMcpToolProvider,
} from "./tabCatalogAdapters";
import type { TabData } from "./types";

export function initializeSlashCommands(
  tab: TabData,
  ports: ChatPorts,
  getHiddenCommands?: () => Set<string>,
  catalogInfo?: {
    config: SlashCommandDropdownConfig;
    getEntries: () => Promise<SlashCatalogEntry[]>;
  } | null,
): void {
  const { dom } = tab;

  tab.ui.slashCommandDropdown = new SlashCommandDropdown(
    dom.inputContainerEl,
    dom.richInput,
    {
      onSelect: () => undefined,
    },
    {
      hiddenCommands: getHiddenCommands?.() ?? new Set(),
      catalogConfig: catalogInfo?.config,
      getCatalogEntries: catalogInfo?.getEntries,
      getMcpManager: () => createDropdownMcpServerProvider(ports.catalog),
      getMcpToolProvider: () => createDropdownMcpToolProvider(ports.catalog),
      getSkills: () => ports.catalog.listSkills(),
    },
  );
}

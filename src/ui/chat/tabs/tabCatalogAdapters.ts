import type { ChatCatalogPort } from '@pivi/obsidian-ui/ports';

import type {
  DropdownMcpServerProvider,
  DropdownMcpToolProvider,
} from '../../shared/components/slashCommandDropdownData';
import type { FileContextMcpProvider } from '../ui/FileContext';

/** Catalog-backed MCP provider for FileContext badges and mention dropdown. */
export function createFileContextMcpProvider(
  catalog: ChatCatalogPort,
): FileContextMcpProvider {
  return {
    getServers: () => catalog.listMcpServers(),
    getContextSavingServers: () => catalog.listContextSavingMcpServers(),
  };
}

/** Catalog-backed MCP server list for SlashCommandDropdown. */
export function createDropdownMcpServerProvider(
  catalog: ChatCatalogPort,
): DropdownMcpServerProvider {
  return {
    getServers: () => catalog.listMcpServers(),
  };
}

/** Catalog-backed MCP tool list for SlashCommandDropdown. */
export function createDropdownMcpToolProvider(
  catalog: ChatCatalogPort,
): DropdownMcpToolProvider {
  return {
    listTools: (serverName) => catalog.listMcpTools(serverName),
  };
}

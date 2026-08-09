import { getMcpServerType } from '@pivi/agent/mcp/types';
import type { ChatCatalogPort } from '@pivi/agent/runtime/chatPorts';

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
    getServers: () => catalog.listMcpServers().map((server) => ({
      name: server.name,
      enabled: server.enabled,
      description: server.description,
      type: getMcpServerType(server.config),
    })),
  };
}

/** Catalog-backed MCP tool list for SlashCommandDropdown (automatic inventory path). */
export function createDropdownMcpToolProvider(
  catalog: ChatCatalogPort,
): DropdownMcpToolProvider {
  return {
    listTools: (serverName) => (
      catalog.listMcpInventoryTools?.(serverName) ?? catalog.listMcpTools(serverName)
    ),
  };
}

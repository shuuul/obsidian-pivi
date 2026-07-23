import { getActivePiviNetworkClients } from '@pivi/obsidian-host/createPiviNetworkClients';
import {
  getMcpServerUrl,
  type ManagedMcpServer,
  supportsMcpOAuth,
} from '@pivi/pivi-agent-core/mcp/types';
import { grantPrivateOrigins } from '@pivi/pivi-agent-core/network';
import type { SettingsComplexPorts } from '@pivi/pivi-react/ports';

import type { PiviPluginWorkspace, PiviSettingsHost } from '@/app/hostContracts';

type SettingsMcpPort = SettingsComplexPorts['mcp'];

/** Re-grant MCP private origins from the freshly saved server set. */
function regrantMcpPrivateOrigins(servers: readonly ManagedMcpServer[]): void {
  try {
    const grants = getActivePiviNetworkClients().grants;
    grants.revokeByPurpose('mcp');
    grantPrivateOrigins(
      grants,
      servers.map((server) => getMcpServerUrl(server.config)),
      'mcp',
    );
  } catch {
    // Network clients may not be installed during early teardown; the startup
    // grant pass in createPiWorkspaceServices covers the steady state.
  }
}

/** Warm MCP tool lists and slash caches after config changes without blocking settings UI. */
function warmMcpCaches(host: PiviSettingsHost, workspace: PiviPluginWorkspace): void {
  void (async () => {
    try {
      await workspace.mcpToolProvider.prefetchEnabledServers?.();
    } catch {
      // Best-effort warmup; first slash open or turn will retry.
    }
    for (const view of host.getAllViews()) {
      view.getChatHandle()?.maintenance.warmSlashCatalog();
    }
  })();
}

async function reloadMcpAcrossViews(
  host: PiviSettingsHost,
  workspace: PiviPluginWorkspace,
): Promise<void> {
  workspace.mcpToolProvider.invalidateAll?.();
  for (const view of host.getAllViews()) {
    const maintenance = view.getChatHandle()?.maintenance;
    await maintenance?.reloadMcpServers();
    maintenance?.invalidateSlashCatalog();
  }
  warmMcpCaches(host, workspace);
}

export function createMcpSettingsPort(
  host: PiviSettingsHost,
  workspace: PiviPluginWorkspace,
): SettingsMcpPort {
  return {
    load: () => workspace.mcpStorage.load(),
    listTools: serverName => Promise.resolve(workspace.mcpToolProvider.getCachedTools(serverName)),
    async save(servers) {
      await workspace.mcpStorage.save([...servers]);
      regrantMcpPrivateOrigins(servers);
      await reloadMcpAcrossViews(host, workspace);
    },
    async connect(server) {
      let authStatus = (await workspace.mcpOAuth?.getAuthStatus(server)) ?? null;
      if (
        supportsMcpOAuth(server)
        && authStatus !== 'authenticated'
        && authStatus !== 'not_applicable'
      ) {
        if (server.auth === undefined && server.oauth === undefined) {
          const unauthenticated = await workspace.mcpServerTester.testServer(server);
          authStatus = unauthenticated.success
            ? 'not_applicable'
            : (await workspace.mcpOAuth?.authenticate(server)) ?? null;
        } else {
          authStatus = (await workspace.mcpOAuth?.authenticate(server)) ?? null;
        }
      }
      const result = await workspace.mcpDiagnostics.testConnection(server);
      if (result.success) {
        workspace.mcpToolProvider.cacheTools(server.name, result.tools);
        for (const view of host.getAllViews()) {
          const maintenance = view.getChatHandle()?.maintenance;
          maintenance?.invalidateSlashCatalog();
          maintenance?.warmSlashCatalog();
        }
      }
      return { authStatus, result };
    },
    getAuthStatus: async server => (await workspace.mcpOAuth?.getAuthStatus(server)) ?? null,
    async logout(serverName) {
      await workspace.mcpOAuth?.logout(serverName);
      await reloadMcpAcrossViews(host, workspace);
    },
  };
}

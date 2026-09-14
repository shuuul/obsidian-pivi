import { PluginLogger } from '@pivi/agent/logging/pluginLogger';
import {
  getMcpServerUrl,
  type ManagedMcpServer,
  supportsMcpOAuth,
} from '@pivi/agent/mcp/types';
import { grantPrivateOrigins } from '@pivi/agent/network';
import { getActivePiviNetworkClients } from '@pivi/obsidian-host/createPiviNetworkClients';
import type { SettingsComplexPorts } from '@pivi/pivi-react/ports';

import type {
  PiviChatView,
  PiviChatViewMaintenance,
  PiviPluginWorkspace,
  PiviSettingsHost,
} from '@/app/hostContracts';

type SettingsMcpPort = SettingsComplexPorts['mcp'];
const logger = new PluginLogger('McpSettingsPorts');

// Settle every view independently so one disposed or failing view cannot abort
// the reload loop and leave later views stale; keeps per-view failures logged.
async function settleViewOperations(
  views: readonly PiviChatView[],
  operation: (maintenance: PiviChatViewMaintenance) => Promise<void> | void,
  failureMessage: string,
): Promise<void> {
  for (const view of views) {
    const maintenance = view.getChatHandle()?.maintenance;
    if (!maintenance) continue;
    try {
      await operation(maintenance);
    } catch (error) {
      logger.warn(failureMessage, error);
    }
  }
}

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
    await settleViewOperations(
      host.getAllViews(),
      maintenance => maintenance.warmSlashCatalog(),
      'Failed to warm MCP slash catalog in a Pivi view',
    );
  })();
}

async function reloadMcpAcrossViews(
  host: PiviSettingsHost,
  workspace: PiviPluginWorkspace,
): Promise<void> {
  workspace.mcpToolProvider.invalidateAll?.();
  await settleViewOperations(
    host.getAllViews(),
    async (maintenance) => {
      await maintenance.reloadMcpServers();
      maintenance.invalidateSlashCatalog();
    },
    'Failed to reload MCP in a Pivi view',
  );
  warmMcpCaches(host, workspace);
}

export function createMcpSettingsPort(
  host: PiviSettingsHost,
  workspace: PiviPluginWorkspace,
): SettingsMcpPort {
  let loadedRevision: string | null = null;
  return {
    async load() {
      const snapshot = await workspace.mcpManagement.loadSettingsSnapshot();
      loadedRevision = snapshot.revision;
      return snapshot.servers;
    },
    listTools: serverName => Promise.resolve(workspace.mcpToolProvider.getCachedTools(serverName)),
    async save(servers) {
      const expectedRevision = loadedRevision ?? await workspace.mcpManagement.getRevision();
      const committed = await workspace.mcpManagement.replaceAll(servers, expectedRevision);
      loadedRevision = committed.revision;
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
        await settleViewOperations(
          host.getAllViews(),
          (maintenance) => {
            maintenance.invalidateSlashCatalog();
            maintenance.warmSlashCatalog();
          },
          'Failed to refresh MCP tools in a Pivi view',
        );
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

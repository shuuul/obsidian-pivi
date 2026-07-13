import type { SettingsComplexPorts } from '@pivi/pivi-react/ports';

import type { PiviPluginWorkspace, PiviSettingsHost } from '@/app/hostContracts';

type SettingsMcpPort = SettingsComplexPorts['mcp'];

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
    listTools: serverName => workspace.mcpToolProvider.listTools(serverName),
    async save(servers) {
      await workspace.mcpStorage.save([...servers]);
      await reloadMcpAcrossViews(host, workspace);
    },
    test: server => workspace.mcpServerTester.testServer(server),
    getAuthStatus: async server => (await workspace.mcpOAuth?.getAuthStatus(server)) ?? null,
    async authenticate(server) {
      if (server.auth === undefined && server.oauth === undefined) {
        const unauthenticated = await workspace.mcpServerTester.testServer(server);
        if (unauthenticated.success) {
          return 'not_applicable';
        }
      }
      return (await workspace.mcpOAuth?.authenticate(server)) ?? null;
    },
    logout: async serverName => { await workspace.mcpOAuth?.logout(serverName); },
    async reload() {
      await reloadMcpAcrossViews(host, workspace);
    },
  };
}

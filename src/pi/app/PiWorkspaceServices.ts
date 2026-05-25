import { AgentWorkspace } from '../../core/agent/AgentWorkspace';
import type {
  AppMcpStorage,
  AppMcpToolProvider,
  AppSkillProvider,
  WorkspaceRegistration,
  WorkspaceServices,
} from '../../core/agent/types';
import type { AppMcpToolSummary } from '../../core/agent/types';
import { McpServerManager } from '../../core/mcp/McpServerManager';
import { getVaultPath } from '../../utils/path';
import { ProviderOAuthService } from '../auth/ProviderOAuthService';
import { initializeOAuth } from '../mcp/oauth/McpAuthFlow';
import { McpOAuthService } from '../mcp/oauth/McpOAuthService';
import { PiMcpConnectionPool } from '../mcp/PiMcpConnectionPool';
import { VaultSkillsService } from '../skills/VaultSkillsService';
import { McpStorage } from '../storage/McpStorage';
import { piSettingsTabRenderer } from '../ui/PiSettingsTab';

export interface PiWorkspaceServices extends WorkspaceServices {
  mcpStorage: AppMcpStorage;
  mcpServerManager: McpServerManager;
  mcpToolProvider: AppMcpToolProvider;
  skillProvider: AppSkillProvider;
  mcpOAuth: McpOAuthService;
  providerOAuth: ProviderOAuthService;
}

class PiMcpToolProvider implements AppMcpToolProvider {
  private readonly pool: PiMcpConnectionPool;
  private readonly cache = new Map<string, AppMcpToolSummary[]>();

  constructor(
    private readonly mcpServerManager: McpServerManager,
    mcpOAuth: McpOAuthService,
  ) {
    this.pool = new PiMcpConnectionPool(mcpOAuth);
  }

  async listTools(serverName: string): Promise<AppMcpToolSummary[]> {
    const cached = this.cache.get(serverName);
    if (cached) {
      return cached;
    }

    const server = this.mcpServerManager.getServers().find((candidate) => candidate.name === serverName);
    if (!server || !server.enabled) {
      return [];
    }

    const disabled = new Set(server.disabledTools ?? []);
    const tools = (await this.pool.listTools(server))
      .filter((tool) => !disabled.has(tool.name))
      .map((tool) => ({ name: tool.name, description: tool.description }));
    this.cache.set(serverName, tools);
    return tools;
  }
}

class PiSkillProvider implements AppSkillProvider {
  private readonly service: VaultSkillsService | null;

  constructor(vaultPath: string | null) {
    this.service = vaultPath ? new VaultSkillsService(vaultPath) : null;
  }

  listSkills() {
    return this.service?.list().map((skill) => ({
      name: skill.name,
      description: skill.description,
    })) ?? [];
  }
}

export async function createPiWorkspaceServices(
  context: Parameters<WorkspaceRegistration['initialize']>[0],
): Promise<PiWorkspaceServices> {
  const mcpStorage = new McpStorage(context.vaultAdapter);
  const mcpServerManager = new McpServerManager(mcpStorage);
  const mcpOAuth = new McpOAuthService(context.vaultAdapter);
  const providerOAuth = new ProviderOAuthService(context.plugin.app);
  const mcpToolProvider = new PiMcpToolProvider(mcpServerManager, mcpOAuth);
  const skillProvider = new PiSkillProvider(getVaultPath(context.plugin.app));
  await mcpServerManager.loadServers();
  await initializeOAuth();

  return {
    settingsTabRenderer: piSettingsTabRenderer,
    mcpStorage,
    mcpServerManager,
    mcpToolProvider,
    skillProvider,
    mcpOAuth,
    providerOAuth,
  };
}

export const piWorkspaceRegistration: WorkspaceRegistration<PiWorkspaceServices> = {
  initialize: async (context) => createPiWorkspaceServices(context),
};

export function maybeGetPiWorkspaceServices(): PiWorkspaceServices | null {
  return AgentWorkspace.getServices() as PiWorkspaceServices | null;
}

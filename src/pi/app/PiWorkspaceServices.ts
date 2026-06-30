import { AgentWorkspace } from '../../core/agent/AgentWorkspace';
import type { SlashCommandCatalog } from '../../core/agent/commands/SlashCommandCatalog';
import type {
  AppMcpServerProbeProvider,
  AppMcpStorage,
  AppMcpToolProvider,
  AppModelReadinessProvider,
  AppSkillProvider,
  WorkspaceRegistration,
  WorkspaceServices,
} from '../../core/agent/types';
import type { AppMcpToolSummary } from '../../core/agent/types';
import { McpServerManager } from '../../core/mcp/McpServerManager';
import { getVaultPath } from '../../utils/path';
import {
  createObsidianCredentialStore,
  ObsidianAuthContext,
  type ObsidianCredentialStore,
} from '../auth/ObsidianCredentialStore';
import { ProviderOAuthService } from '../auth/ProviderOAuthService';
import { initializeOAuth } from '../mcp/oauth/McpAuthFlow';
import { McpOAuthService } from '../mcp/oauth/McpOAuthService';
import { PiMcpConnectionPool } from '../mcp/PiMcpConnectionPool';
import { configurePiAiModels } from '../piAiModels';
import { VaultSkillsService } from '../skills/VaultSkillsService';
import { McpStorage } from '../storage/McpStorage';
import { derivePiModelReadinessStatus, runPiModelReadinessTest } from '../ui/modelReadiness';
import { piSettingsTabRenderer } from '../ui/PiSettingsTab';
import { PiSlashCommandCatalog } from './PiSlashCommandCatalog';

export interface PiWorkspaceServices extends WorkspaceServices {
  mcpStorage: AppMcpStorage;
  mcpServerManager: McpServerManager;
  mcpToolProvider: AppMcpToolProvider;
  mcpServerProbeProvider: AppMcpServerProbeProvider;
  modelReadinessProvider: AppModelReadinessProvider;
  skillProvider: AppSkillProvider;
  mcpOAuth: McpOAuthService;
  credentialStore: ObsidianCredentialStore | null;
  providerOAuth: ProviderOAuthService;
  slashCommandCatalog: SlashCommandCatalog;
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

class PiMcpServerProbeProvider implements AppMcpServerProbeProvider {
  constructor(private readonly mcpToolProvider: AppMcpToolProvider) {}

  async testServer(serverName: string) {
    const tools = await this.mcpToolProvider.listTools(serverName);
    return { toolCount: tools.length };
  }
}

class PiModelReadinessProvider implements AppModelReadinessProvider {
  constructor(
    private readonly credentialStore: ObsidianCredentialStore | null,
    private readonly providerOAuth: ProviderOAuthService,
  ) {}

  getStatus(model: string, settings: Record<string, unknown>) {
    return derivePiModelReadinessStatus(model, settings, {
      credentialStore: this.credentialStore,
      providerOAuth: this.providerOAuth,
    });
  }

  testModel(model: string, settings: Record<string, unknown>) {
    return runPiModelReadinessTest(model, settings);
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
  const mcpStorage = new McpStorage(context.vaultAdapter, context.plugin.app.secretStorage);
  const mcpServerManager = new McpServerManager(mcpStorage);
  const mcpOAuth = new McpOAuthService(context.vaultAdapter);
  const credentialStore = createObsidianCredentialStore(context.plugin.app.secretStorage);
  configurePiAiModels({
    credentials: credentialStore ?? undefined,
    authContext: new ObsidianAuthContext(context.plugin),
  });
  const providerOAuth = new ProviderOAuthService(context.plugin.app, credentialStore);
  const mcpToolProvider = new PiMcpToolProvider(mcpServerManager, mcpOAuth);
  const mcpServerProbeProvider = new PiMcpServerProbeProvider(mcpToolProvider);
  const modelReadinessProvider = new PiModelReadinessProvider(
    credentialStore,
    providerOAuth,
  );
  const skillProvider = new PiSkillProvider(getVaultPath(context.plugin.app));
  const slashCommandCatalog = new PiSlashCommandCatalog(context.plugin, context.vaultAdapter);
  await slashCommandCatalog.refresh();
  await mcpServerManager.loadServers();
  await initializeOAuth();

  return {
    settingsTabRenderer: piSettingsTabRenderer,
    mcpStorage,
    mcpServerManager,
    mcpToolProvider,
    mcpServerProbeProvider,
    modelReadinessProvider,
    skillProvider,
    mcpOAuth,
    credentialStore,
    providerOAuth,
    slashCommandCatalog,
  };
}

export const piWorkspaceRegistration: WorkspaceRegistration<PiWorkspaceServices> = {
  initialize: async (context) => createPiWorkspaceServices(context),
};

export function maybeGetPiWorkspaceServices(): PiWorkspaceServices | null {
  return AgentWorkspace.getServices() as PiWorkspaceServices | null;
}

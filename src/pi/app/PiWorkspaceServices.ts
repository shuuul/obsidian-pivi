import type PiviPlugin from "../../main";
import type { SlashCommandCatalog } from "../../pi/agent/commands/SlashCommandCatalog";
import type {
  AgentSettingsTabRenderer,
  AppMcpServerProbeProvider,
  AppMcpServerTester,
  AppMcpStorage,
  AppMcpToolProvider,
  AppModelReadinessProvider,
  AppSkillProvider,
  WorkspaceInitContext,
} from "../../pi/agent/types";
import type { AppMcpToolSummary } from "../../pi/agent/types";
import { McpServerManager } from "../../pi/mcp/McpServerManager";
import type { SessionStore } from "../../pi/session/types";
import { getVaultPath } from "../../utils/path";
import {
  createObsidianCredentialStore,
  ObsidianAuthContext,
  type ObsidianCredentialStore,
} from "../auth/ObsidianCredentialStore";
import { ProviderOAuthService } from "../auth/ProviderOAuthService";
import { McpStorage } from "../mcp/McpStorage";
import { initializeOAuth } from "../mcp/oauth/McpAuthFlow";
import { McpOAuthService } from "../mcp/oauth/McpOAuthService";
import { PiMcpConnectionPool } from "../mcp/PiMcpConnectionPool";
import { testPiMcpServer } from "../mcp/PiMcpTester";
import { configurePiAiModels } from "../piAiModels";
import { VaultSkillsService } from "../skills/VaultSkillsService";
import {
  derivePiModelReadinessStatus,
  runPiModelReadinessTest,
} from "../ui/modelReadiness";
import { piSettingsTabRenderer } from "../ui/PiSettingsTab";
import { PiSlashCommandCatalog } from "./PiSlashCommandCatalog";

export interface PiWorkspaceServices {
  settingsTabRenderer: AgentSettingsTabRenderer;
  mcpStorage: AppMcpStorage;
  mcpServerManager: McpServerManager;
  mcpToolProvider: AppMcpToolProvider;
  mcpServerProbeProvider: AppMcpServerProbeProvider;
  mcpServerTester: AppMcpServerTester;
  modelReadinessProvider: AppModelReadinessProvider;
  skillProvider: AppSkillProvider;
  mcpOAuth: McpOAuthService;
  credentialStore: ObsidianCredentialStore | null;
  providerOAuth: ProviderOAuthService;
  slashCommandCatalog: SlashCommandCatalog;
  sessionStore: SessionStore | null;
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

    const server = this.mcpServerManager
      .getServers()
      .find((candidate) => candidate.name === serverName);
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

class PiMcpServerTester implements AppMcpServerTester {
  async testServer(server: Parameters<AppMcpServerTester["testServer"]>[0]) {
    return testPiMcpServer(server);
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
    return (
      this.service?.list().map((skill) => ({
        name: skill.name,
        description: skill.description,
      })) ?? []
    );
  }
}

export async function createPiWorkspaceServices(
  context: WorkspaceInitContext,
): Promise<PiWorkspaceServices> {
  const plugin = context.host.rawHost as PiviPlugin;
  const mcpStorage = new McpStorage(
    context.vaultAdapter,
    plugin.app.secretStorage,
  );
  const mcpServerManager = new McpServerManager(mcpStorage);
  const mcpOAuth = new McpOAuthService(context.vaultAdapter);
  const credentialStore = createObsidianCredentialStore(
    plugin.app.secretStorage,
  );
  configurePiAiModels({
    credentials: credentialStore ?? undefined,
    authContext: new ObsidianAuthContext(plugin),
  });
  const providerOAuth = new ProviderOAuthService(plugin.app, credentialStore);
  const mcpToolProvider = new PiMcpToolProvider(mcpServerManager, mcpOAuth);
  const mcpServerProbeProvider = new PiMcpServerProbeProvider(mcpToolProvider);
  const mcpServerTester = new PiMcpServerTester();
  const modelReadinessProvider = new PiModelReadinessProvider(
    credentialStore,
    providerOAuth,
  );
  const skillProvider = new PiSkillProvider(getVaultPath(plugin.app));
  const slashCommandCatalog = new PiSlashCommandCatalog(
    plugin,
    context.vaultAdapter,
  );
  await slashCommandCatalog.refresh();
  await mcpServerManager.loadServers();
  await initializeOAuth();

  return {
    settingsTabRenderer: piSettingsTabRenderer,
    mcpStorage,
    mcpServerManager,
    mcpToolProvider,
    mcpServerProbeProvider,
    mcpServerTester,
    modelReadinessProvider,
    skillProvider,
    mcpOAuth,
    credentialStore,
    providerOAuth,
    slashCommandCatalog,
    sessionStore: context.host.sessionStore ?? null,
  };
}

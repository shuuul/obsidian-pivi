import { nodeFetch } from "@pivi/obsidian-host/nodeFetch";
import type {
  AppMcpServerProbeProvider,
  AppMcpServerTester,
  AppMcpToolProvider,
  AppMcpToolSummary,
  AppModelReadinessProvider,
  AppSkillProvider,
} from "@pivi/obsidian-host/serviceContracts";
import type { ObsidianCredentialStore } from "@pivi/pivi-agent-core/engine/pi/piProviderCredentialStore";
import type { ProviderOAuthService } from "@pivi/pivi-agent-core/engine/pi/piProviderOAuthService";
import type { McpServerManager } from "@pivi/pivi-agent-core/mcp/mcpServerManager";
import type { McpOAuthService } from "@pivi/pivi-agent-core/mcp/oauth/mcpOAuthService";
import { PiMcpConnectionPool } from "@pivi/pivi-agent-core/mcp/piMcpConnectionPool";
import { testPiMcpServer } from "@pivi/pivi-agent-core/mcp/piMcpTester";
import type { ProcessRunner } from "@pivi/pivi-agent-core/ports";
import { VaultSkillsService } from "@pivi/pivi-agent-core/skills/vault/vaultSkillsService";

import {
  derivePiModelReadinessStatus,
  runPiModelReadinessTest,
  runPiProviderReadinessTest,
} from "./modelReadiness";

export class PiMcpToolProvider implements AppMcpToolProvider {
  private readonly pool: PiMcpConnectionPool;
  private readonly cache = new Map<string, AppMcpToolSummary[]>();

  constructor(
    private readonly mcpServerManager: McpServerManager,
    mcpOAuth: McpOAuthService,
  ) {
    this.pool = new PiMcpConnectionPool(mcpOAuth, nodeFetch, process.env);
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

export class PiMcpServerTester implements AppMcpServerTester {
  async testServer(server: Parameters<AppMcpServerTester["testServer"]>[0]) {
    return testPiMcpServer(server, nodeFetch, process.env);
  }
}

export class PiMcpServerProbeProvider implements AppMcpServerProbeProvider {
  constructor(private readonly mcpToolProvider: AppMcpToolProvider) {}

  async testServer(serverName: string) {
    const tools = await this.mcpToolProvider.listTools(serverName);
    return { toolCount: tools.length };
  }
}

export class PiModelReadinessProvider implements AppModelReadinessProvider {
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

  testProvider(providerId: string, settings: Record<string, unknown>) {
    return runPiProviderReadinessTest(providerId, settings);
  }
}

export class PiSkillProvider implements AppSkillProvider {
  private readonly service: VaultSkillsService | null;

  constructor(vaultPath: string | null, processRunner: ProcessRunner) {
    this.service = vaultPath ? new VaultSkillsService(vaultPath, { processRunner }) : null;
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

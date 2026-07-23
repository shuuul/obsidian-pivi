import type { ObsidianCredentialStore } from "@pivi/pivi-agent-core/engine/pi/piProviderCredentialStore";
import type { ProviderOAuthService } from "@pivi/pivi-agent-core/engine/pi/piProviderOAuthService";
import { getPiAgentSettings } from "@pivi/pivi-agent-core/foundation/agentSettings";
import type { AppModelReadinessProvider } from "@pivi/pivi-agent-core/foundation/modelReadiness";
import type { McpServerManager } from "@pivi/pivi-agent-core/mcp/mcpServerManager";
import type { McpOAuthService } from "@pivi/pivi-agent-core/mcp/oauth/mcpOAuthService";
import { PiMcpConnectionPool } from "@pivi/pivi-agent-core/mcp/piMcpConnectionPool";
import { testPiMcpServer } from "@pivi/pivi-agent-core/mcp/piMcpTester";
import type {
  AppMcpDiagnostics,
  AppMcpServerProbeProvider,
  AppMcpServerTester,
  AppMcpToolProvider,
  AppMcpToolSummary,
} from "@pivi/pivi-agent-core/mcp/ports";
import { getMcpServerUrl } from "@pivi/pivi-agent-core/mcp/types";
import type { FetchCompatible, ProcessRunner, SyncSecretStore } from "@pivi/pivi-agent-core/ports";
import type { AppSkillProvider } from "@pivi/pivi-agent-core/skills/skillProvider";
import { VaultSkillsService } from "@pivi/pivi-agent-core/skills/vault/vaultSkillsService";

import {
  derivePiModelReadinessStatus,
  runPiModelReadinessTest,
  runPiProviderReadinessTest,
} from "./modelReadiness";
import { ensureAddedProviderAuths } from "./providerReadiness";

export class PiMcpToolProvider implements AppMcpToolProvider {
  private readonly pool: PiMcpConnectionPool;
  private readonly cache = new Map<string, AppMcpToolSummary[]>();
  private readonly inFlight = new Map<
    string,
    { generation: number; promise: Promise<AppMcpToolSummary[]> }
  >();
  private readonly serverGenerations = new Map<string, number>();
  private cacheGeneration = 0;

  constructor(
    private readonly mcpServerManager: McpServerManager,
    mcpOAuth: McpOAuthService,
    mcpFetch: FetchCompatible,
    secretStorage?: SyncSecretStore,
    stdioCwd?: string,
  ) {
    this.pool = new PiMcpConnectionPool(mcpOAuth, mcpFetch, process.env, secretStorage, stdioCwd);
  }

  invalidate(serverName?: string): void {
    if (serverName) {
      void this.pool.close(serverName);
      this.cache.delete(serverName);
      this.inFlight.delete(serverName);
      this.serverGenerations.set(serverName, this.getServerGeneration(serverName) + 1);
      return;
    }
    this.invalidateAll();
  }

  invalidateAll(): void {
    void this.pool.closeAll();
    this.cache.clear();
    this.inFlight.clear();
    this.cacheGeneration += 1;
  }

  async dispose(): Promise<void> {
    this.cache.clear();
    this.inFlight.clear();
    this.cacheGeneration += 1;
    await this.pool.dispose();
  }

  /** Warm slash/settings tool lists for enabled remote servers without spawning local processes. */
  async prefetchEnabledServers(): Promise<void> {
    const servers = this.mcpServerManager
      .getServers()
      .filter((server) => server.enabled && getMcpServerUrl(server.config));
    await Promise.all(servers.map((server) => this.listTools(server.name)));
  }

  async listTools(serverName: string): Promise<AppMcpToolSummary[]> {
    const cached = this.cache.get(serverName);
    if (cached) {
      return cached;
    }

    const generation = this.getRequestGeneration(serverName);
    const existing = this.inFlight.get(serverName);
    if (existing?.generation === generation) {
      return existing.promise;
    }

    const server = this.mcpServerManager
      .getServers()
      .find((candidate) => candidate.name === serverName);
    if (!server || !server.enabled) {
      return [];
    }

    const promise = Promise.resolve().then(() => this.loadTools(serverName, server, generation));
    this.inFlight.set(serverName, { generation, promise });
    return promise;
  }

  getCachedTools(serverName: string): AppMcpToolSummary[] {
    return this.cache.get(serverName)?.map((tool) => ({ ...tool })) ?? [];
  }

  cacheTools(serverName: string, tools: readonly AppMcpToolSummary[]): void {
    this.serverGenerations.set(serverName, this.getServerGeneration(serverName) + 1);
    this.cache.set(serverName, tools.map((tool) => ({ ...tool })));
    this.inFlight.delete(serverName);
  }

  private async loadTools(
    serverName: string,
    server: ReturnType<McpServerManager["getServers"]>[number],
    generation: number,
  ): Promise<AppMcpToolSummary[]> {
    try {
      const disabled = new Set(server.disabledTools ?? []);
      const tools = (await this.pool.listTools(server))
        .filter((tool) => !disabled.has(tool.name))
        .map((tool) => ({ name: tool.name, description: tool.description }));
      if (this.getRequestGeneration(serverName) === generation) {
        this.cache.set(serverName, tools);
      }
      return tools;
    } finally {
      const active = this.inFlight.get(serverName);
      if (active?.generation === generation) {
        this.inFlight.delete(serverName);
      }
    }
  }

  private getRequestGeneration(serverName: string): number {
    return this.cacheGeneration + this.getServerGeneration(serverName);
  }

  private getServerGeneration(serverName: string): number {
    return this.serverGenerations.get(serverName) ?? 0;
  }
}

export class PiMcpDiagnostics implements AppMcpDiagnostics {
  private readonly pool: PiMcpConnectionPool;

  constructor(
    mcpOAuth: McpOAuthService,
    mcpFetch: FetchCompatible,
    secretStorage?: SyncSecretStore,
    stdioCwd?: string,
  ) {
    this.pool = new PiMcpConnectionPool(mcpOAuth, mcpFetch, process.env, secretStorage, stdioCwd);
  }

  async testConnection(server: Parameters<AppMcpDiagnostics["testConnection"]>[0]) {
    try {
      await this.pool.close(server.name);
      const tools = await this.pool.listTools({ ...server, disabledTools: undefined });
      return { success: true, tools };
    } catch (cause) {
      return {
        success: false,
        tools: [],
        error: cause instanceof Error ? cause.message : `Failed to reach MCP server "${server.name}"`,
      };
    }
  }

  dispose(): Promise<void> {
    return this.pool.dispose();
  }
}

export class PiMcpServerTester implements AppMcpServerTester {
  constructor(
    private readonly mcpFetch: FetchCompatible,
    private readonly secretStorage?: SyncSecretStore,
    private readonly stdioCwd?: string,
  ) {}

  async testServer(server: Parameters<AppMcpServerTester["testServer"]>[0]) {
    return testPiMcpServer(server, this.mcpFetch, process.env, this.secretStorage, this.stdioCwd);
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

  ensureProviderCredentials(settings: Record<string, unknown>) {
    const piSettings = getPiAgentSettings(settings);
    return ensureAddedProviderAuths(piSettings.addedProviders, piSettings);
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

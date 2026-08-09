import { getPiAgentSettings } from "@pivi/agent/foundation/agentSettings";
import type { AppModelReadinessProvider } from "@pivi/agent/foundation/modelReadiness";
import type { McpServerManager } from "@pivi/agent/mcp/mcpServerManager";
import type { McpOAuthService } from "@pivi/agent/mcp/oauth/mcpOAuthService";
import { PiMcpConnectionPool } from "@pivi/agent/mcp/piMcpConnectionPool";
import { testPiMcpServer } from "@pivi/agent/mcp/piMcpTester";
import type {
  AppMcpDiagnostics,
  AppMcpServerProbeProvider,
  AppMcpServerTester,
  AppMcpToolProvider,
  AppMcpToolSummary,
} from "@pivi/agent/mcp/ports";
import { getMcpServerUrl } from "@pivi/agent/mcp/types";
import type { FetchCompatible, ProcessRunner, SyncSecretStore } from "@pivi/agent/ports";
import type { AppSkillProvider } from "@pivi/agent/skills/skillProvider";
import { VaultSkillsService } from "@pivi/agent/skills/vault/vaultSkillsService";
import type { ObsidianCredentialStore } from "@pivi/engine-pi/piProviderCredentialStore";
import type { ProviderOAuthService } from "@pivi/engine-pi/piProviderOAuthService";

import {
  derivePiModelReadinessStatus,
  runPiModelReadinessTest,
  runPiProviderReadinessTest,
} from "./modelReadiness";
import { ensureAddedProviderAuths } from "./providerReadiness";

export class PiMcpToolProvider implements AppMcpToolProvider {
  private readonly pool: PiMcpConnectionPool;
  private readonly cache = new Map<string, AppMcpToolSummary[]>();
  /** Keyed by `${mode}:${serverName}` so inventory never joins an OAuth runtime flight. */
  private readonly inFlight = new Map<
    string,
    { generation: number; promise: Promise<AppMcpToolSummary[]> }
  >();
  private readonly serverGenerations = new Map<string, number>();
  private cacheGeneration = 0;
  private readonly lifecycleAbortController = new AbortController();

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
      this.clearInFlight(serverName);
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
    this.lifecycleAbortController.abort();
    this.cache.clear();
    this.inFlight.clear();
    this.cacheGeneration += 1;
    await this.pool.dispose();
  }

  /** Warm slash/settings tool lists for enabled remote servers without spawning local processes. */
  async prefetchEnabledServers(signal?: AbortSignal): Promise<void> {
    const servers = this.mcpServerManager
      .getServers()
      .filter((server) => server.enabled && getMcpServerUrl(server.config));
    const probeSignal = signal ?? this.lifecycleAbortController.signal;
    await Promise.all(servers.map((server) => this.listInventoryTools(server.name, probeSignal)));
  }

  /** Runtime/agent path: may use the normal OAuth-capable connection pool. */
  async listTools(serverName: string): Promise<AppMcpToolSummary[]> {
    return this.loadToolsCached(serverName, 'runtime');
  }

  /**
   * Automatic slash/settings inventory: remote-only, non-authenticating probe.
   * Never starts stdio and never creates/refreshes/persists OAuth material.
   */
  async listInventoryTools(serverName: string, signal?: AbortSignal): Promise<AppMcpToolSummary[]> {
    return this.loadToolsCached(serverName, 'inventory', signal);
  }

  getCachedTools(serverName: string): AppMcpToolSummary[] {
    return this.cache.get(serverName)?.map((tool) => ({ ...tool })) ?? [];
  }

  cacheTools(serverName: string, tools: readonly AppMcpToolSummary[]): void {
    this.serverGenerations.set(serverName, this.getServerGeneration(serverName) + 1);
    this.cache.set(serverName, tools.map((tool) => ({ ...tool })));
    this.clearInFlight(serverName);
  }

  private async loadToolsCached(
    serverName: string,
    mode: 'runtime' | 'inventory',
    signal?: AbortSignal,
  ): Promise<AppMcpToolSummary[]> {
    const cached = this.cache.get(serverName);
    if (cached) {
      return cached;
    }

    const generation = this.getRequestGeneration(serverName);
    const flightKey = `${mode}:${serverName}`;
    const existing = this.inFlight.get(flightKey);
    if (existing?.generation === generation) {
      return existing.promise;
    }

    const server = this.mcpServerManager
      .getServers()
      .find((candidate) => candidate.name === serverName);
    if (!server || !server.enabled) {
      return [];
    }

    // Automatic inventory never spawns local processes.
    if (mode === 'inventory' && !getMcpServerUrl(server.config)) {
      return [];
    }

    const promise = Promise.resolve().then(() => this.loadTools(serverName, server, generation, mode, signal));
    this.inFlight.set(flightKey, { generation, promise });
    return promise;
  }

  private async loadTools(
    serverName: string,
    server: ReturnType<McpServerManager["getServers"]>[number],
    generation: number,
    mode: 'runtime' | 'inventory',
    signal?: AbortSignal,
  ): Promise<AppMcpToolSummary[]> {
    const flightKey = `${mode}:${serverName}`;
    try {
      const disabled = new Set(server.disabledTools ?? []);
      // Inventory uses pool.probe → testPiMcpServer (no OAuth provider / no token persist).
      const listed = mode === 'inventory'
        ? await this.pool.probe(server, signal)
        : await this.pool.listTools(server);
      const tools = listed
        .filter((tool) => !disabled.has(tool.name))
        .map((tool) => ({ name: tool.name, description: tool.description }));
      if (this.getRequestGeneration(serverName) === generation) {
        this.cache.set(serverName, tools);
      }
      return tools;
    } finally {
      const active = this.inFlight.get(flightKey);
      if (active?.generation === generation) {
        this.inFlight.delete(flightKey);
      }
    }
  }

  private clearInFlight(serverName?: string): void {
    if (!serverName) {
      this.inFlight.clear();
      return;
    }
    for (const key of [...this.inFlight.keys()]) {
      if (key.endsWith(`:${serverName}`)) {
        this.inFlight.delete(key);
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

  async testConnection(server: Parameters<AppMcpDiagnostics["testConnection"]>[0], signal?: AbortSignal) {
    try {
      await this.pool.close(server.name);
      const target = { ...server, disabledTools: undefined };
      const tools = signal
        ? await this.pool.listTools(target, signal)
        : await this.pool.listTools(target);
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

  async testServer(server: Parameters<AppMcpServerTester["testServer"]>[0], signal?: AbortSignal) {
    return testPiMcpServer(server, this.mcpFetch, process.env, this.secretStorage, this.stdioCwd, signal);
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

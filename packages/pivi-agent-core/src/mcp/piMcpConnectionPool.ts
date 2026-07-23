import { Client } from "@modelcontextprotocol/sdk/client";
import type { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport";

import { PluginLogger } from '../foundation/pluginLogger';
import type { SyncSecretStore } from '../ports';
import type { HighRiskApprovalController } from '../runtime/highRisk/approvalController';
import { classifyMcpArtifactWrite, classifyStdioMcpLaunch } from '../runtime/highRisk/classify';
import { getHighRiskExecutionContext } from '../runtime/highRisk/executionContext';
import { createLegacySseTransport } from "./legacySseTransport";
import {
  buildMcpArtifactVaultPath,
  formatMcpArtifactReference,
  serializeBoundedMcpArtifact,
} from './mcpArtifactFallback';
import {
  buildMcpStdioEnv,
  createMcpResolveHost,
  resolveAndBuildMcpStdioEnv,
  resolveMcpBearerToken,
  resolveMcpHeaders,
} from "./mcpProcessEnv";
import { materializeMcpToolResult, McpResultBudgetError } from './mcpResultBudget';
import { parseCommand } from "./mcpUtils";
import {
  assertMcpStdioExecutable,
} from "./mcpValidation";
import {
  isLegacyPlainStringMap,
  normalizeMcpStoredValueMap,
} from './mcpValueSources';
import type { McpOAuthService } from "./oauth/mcpOAuthService";
import { testPiMcpServer } from "./piMcpTester";
import type { McpProcessEnv, McpTransportFetch } from "./ports";
import type { McpTool } from "./types";
import type { ManagedMcpServer } from "./types";
import { getMcpServerType, supportsMcpOAuth } from "./types";

/** Writes a bounded Vault-relative MCP artifact after high-risk authorization. */
export type McpArtifactWriter = (args: {
  vaultRelativePath: string;
  content: string;
}) => Promise<void>;

interface UrlServerConfig {
  url: string;
  headers?: Record<string, string>;
}

interface ServerConnection {
  client: Client;
  transport: Transport;
  tools: McpTool[];
}

interface PendingConnection {
  generation: number;
  promise: Promise<ServerConnection>;
}


function mergeBearerHeaders(
  headers: Record<string, string> | undefined,
  bearerToken: string,
): Record<string, string> {
  return {
    ...headers,
    Authorization: headers?.Authorization ?? `Bearer ${bearerToken}`,
  };
}

function resolveStoredHeaders(
  serverName: string,
  headers: unknown,
  processEnv: McpProcessEnv,
  secretStorage: SyncSecretStore | undefined,
): Record<string, string> | undefined {
  if (isLegacyPlainStringMap(headers)) {
    return headers;
  }
  const stored = normalizeMcpStoredValueMap(headers);
  if (!stored) {
    return undefined;
  }
  const host = createMcpResolveHost(processEnv, secretStorage);
  const resolved = resolveMcpHeaders(serverName, stored, host, secretStorage);
  return Object.keys(resolved).length > 0 ? resolved : undefined;
}

function resolveStoredEnv(
  serverName: string,
  env: unknown,
  processEnv: McpProcessEnv,
  secretStorage: SyncSecretStore | undefined,
): Record<string, string> {
  if (isLegacyPlainStringMap(env)) {
    return buildMcpStdioEnv(processEnv, env);
  }
  const stored = normalizeMcpStoredValueMap(env);
  const host = createMcpResolveHost(processEnv, secretStorage);
  return resolveAndBuildMcpStdioEnv(serverName, processEnv, stored, host, secretStorage);
}

function createTransport(
  server: ManagedMcpServer,
  oauth: McpOAuthService | null,
  fetch: McpTransportFetch,
  processEnv: McpProcessEnv,
  secretStorage: SyncSecretStore | undefined,
  stdioCwd: string | undefined,
): Transport {
  const config = server.config;
  const type = getMcpServerType(config);

  if (type === "stdio") {
    const stdio = config as {
      command: string;
      args?: string[];
      env?: unknown;
    };
    const { cmd, args } = parseCommand(stdio.command, stdio.args);
    if (!cmd) {
      throw new Error("MCP stdio server is missing command");
    }
    assertMcpStdioExecutable(cmd);
    return new StdioClientTransport({
      command: cmd,
      args,
      env: resolveStoredEnv(server.name, stdio.env, processEnv, secretStorage),
      stderr: "ignore",
      ...(stdioCwd ? { cwd: stdioCwd } : {}),
    });
  }

  const urlConfig = config as UrlServerConfig;
  const url = new URL(urlConfig.url);
  const resolvedHeaders = resolveStoredHeaders(
    server.name,
    urlConfig.headers,
    processEnv,
    secretStorage,
  );
  const options: {
    fetch: typeof fetch;
    requestInit?: RequestInit;
    authProvider?: OAuthClientProvider;
  } = {
    fetch,
    requestInit: resolvedHeaders ? { headers: resolvedHeaders } : undefined,
  };

  if (supportsMcpOAuth(server) && oauth) {
    const authProvider = oauth.createAuthProvider(server);
    if (authProvider) {
      options.authProvider = authProvider;
    }
  } else if (server.auth === "bearer") {
    const bearerToken = resolveMcpBearerToken(server, processEnv);
    if (bearerToken) {
      options.requestInit = {
        ...options.requestInit,
        headers: mergeBearerHeaders(
          options.requestInit?.headers as Record<string, string> | undefined,
          bearerToken,
        ),
      };
    }
  }

  return type === "sse"
    ? createLegacySseTransport(url, options)
    : new StreamableHTTPClientTransport(url, options);
}

const logger = new PluginLogger('PiMcpConnectionPool');

export class PiMcpConnectionPool {
  constructor(
    private readonly oauth: McpOAuthService | null,
    private readonly fetch: McpTransportFetch,
    private readonly processEnv: McpProcessEnv,
    private readonly secretStorage?: SyncSecretStore,
    private readonly stdioCwd?: string,
    private readonly highRisk?: HighRiskApprovalController | null,
    private readonly artifactWriter?: McpArtifactWriter | null,
  ) {}

  private readonly connections = new Map<string, ServerConnection>();
  private readonly connectPromises = new Map<string, PendingConnection>();
  private readonly pendingConnections = new Set<Promise<ServerConnection>>();
  private readonly serverGenerations = new Map<string, number>();
  private readonly launchedStdioServers = new Set<string>();
  private generation = 0;
  private disposed = false;

  async listTools(
    server: ManagedMcpServer,
    signal?: AbortSignal,
  ): Promise<McpTool[]> {
    const connection = await this.connect(server, signal);
    return connection.tools;
  }

  async callTool(
    server: ManagedMcpServer,
    toolName: string,
    args: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<string> {
    const connection = await this.connect(server, signal);
    const result = await connection.client.callTool(
      { name: toolName, arguments: args },
      undefined,
      { signal },
    );

    let materialized;
    try {
      materialized = materializeMcpToolResult(result.content);
    } catch (error) {
      if (error instanceof McpResultBudgetError) {
        const artifact = await this.tryWriteOversizedArtifact(
          server.name,
          toolName,
          result.content,
          error.violation,
        );
        if (artifact) {
          return artifact;
        }
        throw new Error(
          `MCP tool "${toolName}" on "${server.name}" exceeded result budget (${error.violation}). `
            + 'Full oversized payloads are never entered into context or session history.',
        );
      }
      throw error;
    }

    if (result.isError) {
      throw new Error(materialized.text || `MCP tool "${toolName}" failed`);
    }

    return materialized.text;
  }

  private async tryWriteOversizedArtifact(
    serverName: string,
    toolName: string,
    content: unknown,
    violation: string,
  ): Promise<string | null> {
    if (!this.artifactWriter || !this.highRisk) {
      return null;
    }

    const vaultRelativePath = buildMcpArtifactVaultPath(serverName, toolName);
    const classification = classifyMcpArtifactWrite(vaultRelativePath);
    const nested = getHighRiskExecutionContext();
    const controller = nested?.controller ?? this.highRisk;
    await controller.requireAuthorized({
      kind: classification.kind,
      resources: classification.resources,
      toolName: 'mcp',
    });

    const artifactBody = serializeBoundedMcpArtifact(content, violation);
    await this.artifactWriter({
      vaultRelativePath,
      content: artifactBody,
    });

    return formatMcpArtifactReference(serverName, toolName, violation, vaultRelativePath);
  }

  async probe(server: ManagedMcpServer): Promise<McpTool[]> {
    const result = await testPiMcpServer(server, this.fetch, this.processEnv);
    if (!result.success) {
      throw new Error(
        result.error ?? `Failed to reach MCP server "${server.name}"`,
      );
    }
    return result.tools;
  }

  async close(serverName: string): Promise<void> {
    this.serverGenerations.set(serverName, this.getServerGeneration(serverName) + 1);
    this.connectPromises.delete(serverName);
    const connection = this.connections.get(serverName);
    this.connections.delete(serverName);
    if (connection) {
      await this.closeConnection(connection);
    }
  }

  async closeAll(): Promise<void> {
    this.generation += 1;
    const connections = [...this.connections.values()];
    this.connections.clear();
    this.connectPromises.clear();
    this.launchedStdioServers.clear();
    await Promise.all(connections.map((connection) => this.closeConnection(connection)));
  }

  async dispose(): Promise<void> {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    await this.closeAll();
    await Promise.allSettled([...this.pendingConnections]);
  }

  private async connect(
    server: ManagedMcpServer,
    signal?: AbortSignal,
  ): Promise<ServerConnection> {
    if (this.disposed) {
      throw new Error("MCP connection pool is disposed");
    }

    const generation = this.getGeneration(server.name);
    const existing = this.connections.get(server.name);
    if (existing) {
      return existing;
    }

    const pending = this.connectPromises.get(server.name);
    if (pending?.generation === generation) {
      return pending.promise;
    }

    const promise = this.acceptConnection(
      server.name,
      generation,
      this.createConnection(server, signal),
    );
    const entry = { generation, promise };
    this.connectPromises.set(server.name, entry);
    this.pendingConnections.add(promise);

    try {
      return await promise;
    } finally {
      this.pendingConnections.delete(promise);
      if (this.connectPromises.get(server.name) === entry) {
        this.connectPromises.delete(server.name);
      }
    }
  }

  private async authorizeStdioLaunch(server: ManagedMcpServer): Promise<void> {
    if (getMcpServerType(server.config) !== 'stdio') {
      return;
    }
    if (server.stdioActivationConfirmed !== true) {
      throw new Error(
        `MCP stdio server "${server.name}" is inactive until its executable, arguments, cwd, and environment variable names are confirmed in Settings → MCP.`,
      );
    }
    if (this.connections.has(server.name) || this.launchedStdioServers.has(server.name)) {
      return;
    }
    if (!this.highRisk) {
      // Settings diagnostics may connect without a turn-scoped controller after
      // activation confirmation; agent turns always inject a controller.
      this.launchedStdioServers.add(server.name);
      return;
    }

    const stdio = server.config as {
      command: string;
      args?: string[];
      env?: Record<string, unknown> | undefined;
    };
    const { cmd, args } = parseCommand(stdio.command, stdio.args);
    const envVarNames = stdio.env && typeof stdio.env === 'object'
      ? Object.keys(stdio.env)
      : [];
    const classification = classifyStdioMcpLaunch({
      mcpServer: server.name,
      executable: cmd,
      args,
      cwd: this.stdioCwd,
      envVarNames,
    });

    const nested = getHighRiskExecutionContext();
    const controller = nested?.controller ?? this.highRisk;
    await controller.requireAuthorized({
      kind: classification.kind,
      resources: classification.resources,
      toolName: 'mcp',
    });
    this.launchedStdioServers.add(server.name);
  }

  private async acceptConnection(
    serverName: string,
    generation: number,
    connectionPromise: Promise<ServerConnection>,
  ): Promise<ServerConnection> {
    const connection = await connectionPromise;
    if (this.disposed || this.getGeneration(serverName) !== generation) {
      await this.closeConnection(connection);
      throw new Error(`MCP connection for "${serverName}" was invalidated`);
    }
    this.connections.set(serverName, connection);
    return connection;
  }

  private getGeneration(serverName: string): number {
    return this.generation + this.getServerGeneration(serverName);
  }

  private getServerGeneration(serverName: string): number {
    return this.serverGenerations.get(serverName) ?? 0;
  }

  private async closeConnection(connection: ServerConnection): Promise<void> {
    const results = await Promise.allSettled([
      connection.client.close(),
      connection.transport.close?.() ?? Promise.resolve(),
    ]);
    const [clientResult, transportResult] = results;
    if (clientResult?.status === "rejected") {
      logger.warn('MCP client close failed', clientResult.reason);
    }
    if (transportResult?.status === "rejected") {
      logger.warn('MCP transport close failed', transportResult.reason);
    }
  }

  private async createConnection(
    server: ManagedMcpServer,
    signal?: AbortSignal,
  ): Promise<ServerConnection> {
    await this.authorizeStdioLaunch(server);
    const transport = createTransport(
      server,
      this.oauth,
      this.fetch,
      this.processEnv,
      this.secretStorage,
      this.stdioCwd,
    );
    const client = new Client({ name: "pivi-mcp", version: "0.1.0" });
    await client.connect(transport, signal ? { signal } : undefined);

    let tools: McpTool[];
    try {
      const listed = await client.listTools(
        undefined,
        signal ? { signal } : undefined,
      );
      tools = listed.tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
      }));
    } catch (error) {
      logger.warn(`MCP listTools failed for "${server.name}"`, error);
      tools = [];
    }

    const disabled = new Set(server.disabledTools ?? []);
    tools = tools.filter((tool) => !disabled.has(tool.name));

    return { client, transport, tools };
  }
}

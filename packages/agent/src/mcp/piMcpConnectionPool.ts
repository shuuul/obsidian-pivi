import { Client } from "@modelcontextprotocol/sdk/client";
import type { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport";

import { PluginLogger } from '../foundation/pluginLogger';
import type { SyncSecretStore } from '../ports';
import { createLegacySseTransport } from "./legacySseTransport";
import {
  buildMcpStdioEnv,
  createMcpResolveHost,
  resolveAndBuildMcpStdioEnv,
  resolveMcpBearerToken,
  resolveMcpHeaders,
} from "./mcpProcessEnv";
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

interface UrlServerConfig {
  url: string;
  headers?: Record<string, string>;
}

interface ServerConnection {
  client: Client;
  transport: Transport;
  tools: McpTool[];
  activeCalls: number;
  retired: boolean;
  abortController: AbortController;
  closePromise?: Promise<void>;
  drainPromise?: Promise<void>;
  resolveDrain?: () => void;
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

function combineAbortSignals(
  signals: readonly (AbortSignal | undefined)[],
): { signal: AbortSignal | undefined; dispose: () => void } {
  const active = signals.filter((signal): signal is AbortSignal => !!signal);
  if (active.length === 0) return { signal: undefined, dispose: () => undefined };
  const controller = new AbortController();
  const listeners = active.map((signal) => {
    const abort = () => controller.abort(signal.reason);
    if (signal.aborted) abort();
    signal.addEventListener('abort', abort, { once: true });
    return { signal, abort };
  });
  return {
    signal: controller.signal,
    dispose: () => listeners.forEach(({ signal, abort }) => signal.removeEventListener('abort', abort)),
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
  ) {}

  private readonly connections = new Map<string, ServerConnection>();
  private readonly connectPromises = new Map<string, PendingConnection>();
  private readonly pendingConnections = new Set<Promise<ServerConnection>>();
  private readonly retiredDrains = new Set<Promise<void>>();
  private readonly pendingProbes = new Set<Promise<McpTool[]>>();
  private readonly probeControllers = new Map<string, Set<AbortController>>();
  private readonly disposeAbortController = new AbortController();
  private readonly serverGenerations = new Map<string, number>();
  private generation = 0;
  private disposed = false;

  async listTools(
    server: ManagedMcpServer,
    signal?: AbortSignal,
  ): Promise<McpTool[]> {
    const connection = await this.acquire(server, signal);
    try {
      return connection.tools;
    } finally {
      await this.release(connection);
    }
  }

  async callTool(
    server: ManagedMcpServer,
    toolName: string,
    args: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<string> {
    const connection = await this.acquire(server, signal);
    const combined = combineAbortSignals([signal, connection.abortController.signal]);
    try {
      const result = await connection.client.callTool(
        { name: toolName, arguments: args },
        undefined,
        combined.signal ? { signal: combined.signal } : undefined,
      );

      const parts: string[] = [];
      const content = Array.isArray(result.content) ? result.content : [];
      for (const block of content) {
        if (block && typeof block === "object" && "type" in block) {
          const typed = block as {
            type: string;
            text?: string;
            resource?: unknown;
          };
          if (typed.type === "text" && typeof typed.text === "string") {
            parts.push(typed.text);
          } else if (typed.type === "resource") {
            parts.push(JSON.stringify(typed.resource));
          } else {
            parts.push(JSON.stringify(block));
          }
        }
      }

      if (result.isError) {
        throw new Error(parts.join("\n") || `MCP tool "${toolName}" failed`);
      }

      return parts.join("\n") || "(empty result)";
    } finally {
      combined.dispose();
      await this.release(connection);
    }
  }

  /**
   * One-shot non-authenticating inventory connect (headers/bearer only).
   * Does not attach an OAuth client provider and does not persist tokens.
   */
  async probe(server: ManagedMcpServer, signal?: AbortSignal): Promise<McpTool[]> {
    const controller = new AbortController();
    const controllers = this.probeControllers.get(server.name) ?? new Set<AbortController>();
    controllers.add(controller);
    this.probeControllers.set(server.name, controllers);
    const combined = combineAbortSignals([
      controller.signal,
      this.disposeAbortController.signal,
      signal,
    ]);
    const promise = (async () => {
      try {
        const result = await testPiMcpServer(
          server,
          this.fetch,
          this.processEnv,
          this.secretStorage,
          this.stdioCwd,
          combined.signal,
        );
        if (!result.success) {
          throw new Error(
            result.error ?? `Failed to reach MCP server "${server.name}"`,
          );
        }
        return result.tools;
      } finally {
        combined.dispose();
        controllers.delete(controller);
        if (controllers.size === 0) this.probeControllers.delete(server.name);
      }
    })();
    this.pendingProbes.add(promise);
    void promise.then(
      () => this.pendingProbes.delete(promise),
      () => this.pendingProbes.delete(promise),
    );
    return promise;
  }

  async close(serverName: string): Promise<void> {
    this.serverGenerations.set(serverName, this.getServerGeneration(serverName) + 1);
    this.connectPromises.delete(serverName);
    const connection = this.connections.get(serverName);
    this.connections.delete(serverName);
    if (connection) {
      this.trackRetirement(connection);
    }
    this.abortProbes(serverName);
  }

  async closeAll(force = false): Promise<void> {
    this.generation += 1;
    const connections = [...this.connections.values()];
    this.connections.clear();
    this.connectPromises.clear();
    connections.forEach(connection => this.trackRetirement(connection, force));
    for (const serverName of this.probeControllers.keys()) this.abortProbes(serverName);
  }

  async dispose(): Promise<void> {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.disposeAbortController.abort();
    await this.closeAll(true);
    await Promise.allSettled([...this.pendingConnections]);
    await Promise.allSettled([...this.pendingProbes]);
    await Promise.allSettled([...this.retiredDrains]);
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

    const combined = combineAbortSignals([signal, this.disposeAbortController.signal]);
    const promise = this.acceptConnection(
      server.name,
      generation,
      this.createConnection(server, combined.signal).finally(combined.dispose),
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

  private async acquire(
    server: ManagedMcpServer,
    signal?: AbortSignal,
  ): Promise<ServerConnection> {
    const connection = await this.connect(server, signal);
    if (connection.retired) {
      return this.acquire(server, signal);
    }
    connection.activeCalls += 1;
    return connection;
  }

  private async release(connection: ServerConnection): Promise<void> {
    connection.activeCalls = Math.max(0, connection.activeCalls - 1);
    if (connection.retired && connection.activeCalls === 0) {
      await this.closeConnection(connection);
      connection.resolveDrain?.();
    }
  }

  private async retire(connection: ServerConnection, force = false): Promise<void> {
    connection.retired = true;
    if (force) connection.abortController.abort();
    if (connection.activeCalls === 0) {
      await this.closeConnection(connection);
      return;
    }
    connection.drainPromise ??= new Promise<void>((resolve) => {
      connection.resolveDrain = resolve;
    });
    if (!force) {
      await connection.drainPromise;
      return;
    }
    await Promise.race([
      connection.drainPromise,
      new Promise<void>((resolve) => {
        window.setTimeout(resolve, 1000);
      }),
    ]);
    if (connection.activeCalls > 0) {
      await this.closeConnection(connection);
      connection.resolveDrain?.();
    }
  }

  private trackRetirement(connection: ServerConnection, force = false): void {
    const drain = this.retire(connection, force);
    this.retiredDrains.add(drain);
    void drain.finally(() => this.retiredDrains.delete(drain));
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
    if (connection.closePromise) {
      return connection.closePromise;
    }
    connection.closePromise = this.closeConnectionOnce(connection);
    return connection.closePromise;
  }

  private async closeConnectionOnce(connection: ServerConnection): Promise<void> {
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

    return {
      client,
      transport,
      tools,
      activeCalls: 0,
      retired: false,
      abortController: new AbortController(),
    };
  }

  private abortProbes(serverName: string): void {
    for (const controller of this.probeControllers.get(serverName) ?? []) {
      controller.abort();
    }
  }
}

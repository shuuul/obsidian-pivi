import { Client } from "@modelcontextprotocol/sdk/client";
import type { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport";

import type { McpTool } from "../../core/mcp/types";
import type { ManagedMcpServer } from "../../core/types";
import { getMcpServerType, supportsMcpOAuth } from "../../core/types";
import { getEnhancedPath } from "../../utils/env";
import { parseCommand } from "../../utils/mcp";
import { nodeFetch } from "../../utils/nodeFetch";
import { createLegacySseTransport } from "./legacySseTransport";
import type { McpOAuthService } from "./oauth/McpOAuthService";
import { testPiMcpServer } from "./PiMcpTester";

interface UrlServerConfig {
  url: string;
  headers?: Record<string, string>;
}

interface ServerConnection {
  client: Client;
  transport: Transport;
  tools: McpTool[];
}

function resolveBearerToken(server: ManagedMcpServer): string | undefined {
  if (server.bearerToken) {
    return server.bearerToken;
  }
  if (server.bearerTokenEnv) {
    return process.env[server.bearerTokenEnv];
  }
  return undefined;
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

function createTransport(
  server: ManagedMcpServer,
  oauth: McpOAuthService | null,
): Transport {
  const config = server.config;
  const type = getMcpServerType(config);

  if (type === "stdio") {
    const stdio = config as {
      command: string;
      args?: string[];
      env?: Record<string, string>;
    };
    const { cmd, args } = parseCommand(stdio.command, stdio.args);
    if (!cmd) {
      throw new Error("MCP stdio server is missing command");
    }
    return new StdioClientTransport({
      command: cmd,
      args,
      env: {
        ...process.env,
        ...stdio.env,
        PATH: getEnhancedPath(stdio.env?.PATH),
      },
      stderr: "ignore",
    });
  }

  const urlConfig = config as UrlServerConfig;
  const url = new URL(urlConfig.url);
  const options: {
    fetch: typeof fetch;
    requestInit?: RequestInit;
    authProvider?: OAuthClientProvider;
  } = {
    fetch: nodeFetch,
    requestInit: urlConfig.headers ? { headers: urlConfig.headers } : undefined,
  };

  if (supportsMcpOAuth(server) && oauth) {
    const authProvider = oauth.createAuthProvider(server);
    if (authProvider) {
      options.authProvider = authProvider;
    }
  } else if (server.auth === "bearer") {
    const bearerToken = resolveBearerToken(server);
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

export class PiMcpConnectionPool {
  constructor(private readonly oauth: McpOAuthService | null = null) {}

  private readonly connections = new Map<string, ServerConnection>();
  private readonly connectPromises = new Map<
    string,
    Promise<ServerConnection>
  >();

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
  }

  async probe(server: ManagedMcpServer): Promise<McpTool[]> {
    const result = await testPiMcpServer(server);
    if (!result.success) {
      throw new Error(
        result.error ?? `Failed to reach MCP server "${server.name}"`,
      );
    }
    return result.tools;
  }

  closeAll(): void {
    for (const connection of this.connections.values()) {
      void connection.client.close().catch((error: unknown) => {
        console.warn("Pivi: MCP client close failed", error);
      });
      void connection.transport.close?.().catch((error: unknown) => {
        console.warn("Pivi: MCP transport close failed", error);
      });
    }
    this.connections.clear();
    this.connectPromises.clear();
  }

  private async connect(
    server: ManagedMcpServer,
    signal?: AbortSignal,
  ): Promise<ServerConnection> {
    const existing = this.connections.get(server.name);
    if (existing) {
      return existing;
    }

    const pending = this.connectPromises.get(server.name);
    if (pending) {
      return pending;
    }

    const promise = this.createConnection(server, signal);
    this.connectPromises.set(server.name, promise);

    try {
      const connection = await promise;
      this.connections.set(server.name, connection);
      return connection;
    } finally {
      this.connectPromises.delete(server.name);
    }
  }

  private async createConnection(
    server: ManagedMcpServer,
    signal?: AbortSignal,
  ): Promise<ServerConnection> {
    const transport = createTransport(server, this.oauth);
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
      console.warn(`Pivi: MCP listTools failed for "${server.name}"`, error);
      tools = [];
    }

    const disabled = new Set(server.disabledTools ?? []);
    tools = tools.filter((tool) => !disabled.has(tool.name));

    return { client, transport, tools };
  }
}

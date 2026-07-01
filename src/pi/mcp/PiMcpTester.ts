import { Client } from "@modelcontextprotocol/sdk/client";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport";

import { parseCommand } from "../../pi/mcp/mcpUtils";
import type { McpTestResult, McpTool } from "../../pi/mcp/types";
import { getEnhancedPath } from "../../pi/shims/env";
import type { ManagedMcpServer } from "../../pi/types";
import { isMcpSseServerConfig, isMcpStdioServerConfig } from "../../pi/types";
import { nodeFetch } from "../../utils/nodeFetch";
import { createLegacySseTransport } from "./legacySseTransport";

export async function testPiMcpServer(
  server: ManagedMcpServer,
): Promise<McpTestResult> {
  let transport: Transport;
  try {
    if (isMcpStdioServerConfig(server.config)) {
      const config = server.config;
      const { cmd, args } = parseCommand(config.command, config.args);
      if (!cmd) {
        return { success: false, tools: [], error: "Missing command" };
      }
      transport = new StdioClientTransport({
        command: cmd,
        args,
        env: {
          ...process.env,
          ...config.env,
          PATH: getEnhancedPath(config.env?.PATH),
        },
        stderr: "ignore",
      });
    } else {
      const config = server.config;
      const url = new URL(config.url);
      const options = {
        fetch: nodeFetch,
        requestInit: config.headers ? { headers: config.headers } : undefined,
      };
      transport = isMcpSseServerConfig(config)
        ? createLegacySseTransport(url, options)
        : new StreamableHTTPClientTransport(url, options);
    }
  } catch (error) {
    return {
      success: false,
      tools: [],
      error:
        error instanceof Error ? error.message : "Invalid server configuration",
    };
  }

  const client = new Client({ name: "pivi-tester", version: "1.0.0" });
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 10000);

  try {
    await client.connect(transport, { signal: controller.signal });

    const serverVersion = client.getServerVersion();
    let tools: McpTool[] = [];
    try {
      const result = await client.listTools(undefined, {
        signal: controller.signal,
      });
      tools = result.tools.map(
        (t: {
          name: string;
          description?: string;
          inputSchema?: Record<string, unknown>;
        }) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema as Record<string, unknown>,
        }),
      );
    } catch (error) {
      console.warn("Pivi: MCP listTools failed after connect", error);
    }

    return {
      success: true,
      serverName: serverVersion?.name,
      serverVersion: serverVersion?.version,
      tools,
    };
  } catch (error) {
    if (controller.signal.aborted) {
      return { success: false, tools: [], error: "Connection timeout (10s)" };
    }
    return {
      success: false,
      tools: [],
      error: error instanceof Error ? error.message : "Unknown error",
    };
  } finally {
    window.clearTimeout(timeout);
    try {
      await client.close();
    } catch (error) {
      console.warn("Pivi: MCP test client close failed", error);
    }
  }
}

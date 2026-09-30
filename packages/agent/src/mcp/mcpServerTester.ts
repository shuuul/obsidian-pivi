import type { McpClient } from "@earendil-works/pi-mcp";

import { PluginLogger } from '../logging/pluginLogger';
import type { SyncSecretStore } from '../ports';
import { connectMcpHttpClient, type McpHttpConnectionOptions } from "./mcpHttpClient";
import {
  createMcpResolveHost,
  resolveMcpHeaders,
} from "./mcpProcessEnv";
import {
  isLegacyPlainStringMap,
  normalizeMcpStoredValueMap,
} from './mcpValueSources';
import type { McpProcessEnv, McpTransportFetch } from "./ports";
import type { McpTestResult, McpTool } from "./types";
import type { ManagedMcpServer } from "./types";

const logger = new PluginLogger('McpServerTester');

export async function testMcpServer(
  server: ManagedMcpServer,
  fetch: McpTransportFetch,
  processEnv: McpProcessEnv,
  secretStorage?: SyncSecretStore,
  signal?: AbortSignal,
): Promise<McpTestResult> {
  const resolveHost = createMcpResolveHost(processEnv, secretStorage);
  let options: McpHttpConnectionOptions;
  try {
    const config = server.config;
    const url = new URL(config.url);
    const resolvedHeaders = isLegacyPlainStringMap(config.headers)
      ? config.headers
      : resolveMcpHeaders(
        server.name,
        normalizeMcpStoredValueMap(config.headers),
        resolveHost,
        secretStorage,
      );
    options = {
      url: url.href,
      fetch,
      ...(resolvedHeaders && Object.keys(resolvedHeaders).length > 0
        ? { headers: resolvedHeaders }
        : {}),
    };
  } catch (error) {
    return {
      success: false,
      tools: [],
      error:
        error instanceof Error ? error.message : "Invalid server configuration",
    };
  }

  let client: McpClient | undefined;
  const controller = new AbortController();
  const abort = () => controller.abort(signal?.reason);
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  const timeout = window.setTimeout(() => controller.abort(), 10000);

  try {
    const connection = await connectMcpHttpClient("pivi-tester", options, controller.signal);
    client = connection.client;

    const serverVersion = connection.initialize.serverInfo;
    let tools: McpTool[] = [];
    try {
      const result = await client.listTools({
        signal: controller.signal,
      });
      tools = result.map(
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
    } catch {
      if (controller.signal.aborted) {
        return {
          success: false,
          tools: [],
          error: signal?.aborted ? "Connection aborted" : "Connection timeout (10s)",
        };
      }
      logger.warn('MCP test tool listing failed');
    }

    if (controller.signal.aborted) {
      return {
        success: false,
        tools: [],
        error: signal?.aborted ? "Connection aborted" : "Connection timeout (10s)",
      };
    }

    return {
      success: true,
      serverName: serverVersion?.name,
      serverVersion: serverVersion?.version,
      tools,
    };
  } catch (error) {
    if (controller.signal.aborted) {
      return { success: false, tools: [], error: signal?.aborted ? "Connection aborted" : "Connection timeout (10s)" };
    }
    logger.warn('MCP test connection failed');
    return {
      success: false,
      tools: [],
      error: error instanceof Error ? error.message : "Unknown error",
    };
  } finally {
    window.clearTimeout(timeout);
    signal?.removeEventListener('abort', abort);
    try {
      await client?.close();
    } catch {
      logger.warn('MCP test client close failed');
    }
  }
}

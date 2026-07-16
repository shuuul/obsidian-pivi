import { PluginLogger } from '../foundation/pluginLogger';
import type { ToolSpec } from '../tools';
import { createMcpProxyToolSpec } from './createMcpProxyToolSpec';
import type { McpServerManager } from './mcpServerManager';
import type { McpOAuthService } from './oauth/mcpOAuthService';
import { PiMcpConnectionPool } from './piMcpConnectionPool';
import type { McpProcessEnv, McpTransportFetch } from './ports';
import type { McpTool } from './types';
import { getMcpServerUrl, type ManagedMcpServer, type McpServerConfig } from './types';

const logger = new PluginLogger('PiMcpBridge');

interface CachedTools {
  tools: McpTool[];
  fetchedAt: number;
}

/** Turn shape for resolving which MCP servers are active (neutral; no Pi runtime import). */
export interface McpActiveTurn {
  mcpMentions: Iterable<string>;
  request: {
    enabledMcpServers?: Set<string> | null;
  };
}

export class PiMcpBridge {
  private readonly pool: PiMcpConnectionPool;
  private readonly toolCache = new Map<string, CachedTools>();
  private activeMentions = new Set<string>();
  private proxyToolSpec: ToolSpec | null = null;

  constructor(
    private readonly mcpManager: McpServerManager,
    oauth: McpOAuthService | null,
    fetch: McpTransportFetch,
    processEnv: McpProcessEnv,
  ) {
    this.pool = new PiMcpConnectionPool(oauth, fetch, processEnv);
  }

  hasServers(): boolean {
    return this.mcpManager.getServers().some((server) => server.enabled);
  }

  getToolSpecs(): ToolSpec[] {
    if (!this.hasServers()) {
      return [];
    }
    if (!this.proxyToolSpec) {
      this.proxyToolSpec = createMcpProxyToolSpec(this);
    }
    return [this.proxyToolSpec];
  }

  setActiveMentions(mentions: Set<string>): void {
    this.activeMentions = new Set(mentions);
  }

  resolveActiveMentions(turn: McpActiveTurn): Set<string> {
    const merged = new Set(turn.mcpMentions);
    const enabled = turn.request.enabledMcpServers;
    if (enabled) {
      for (const name of enabled) {
        merged.add(name);
      }
    }
    return merged;
  }

  async reload(): Promise<void> {
    await this.mcpManager.loadServers();
    await this.pool.closeAll();
    this.toolCache.clear();
    this.proxyToolSpec = null;
  }

  async dispose(): Promise<void> {
    this.toolCache.clear();
    this.proxyToolSpec = null;
    await this.pool.dispose();
  }

  /** Warm enabled remote tool caches without spawning local stdio processes. */
  async prefetchEnabledTools(): Promise<void> {
    const enabled = this.mcpManager
      .getServers()
      .filter((server) => server.enabled && getMcpServerUrl(server.config));
    await Promise.all(enabled.map((server) => this.listCachedTools(server.name)));
  }

  /** Sync inventory from cache only — never connects. */
  getCachedInventory(): Array<{
    name: string;
    tools: Array<{ name: string; description?: string }>;
  }> {
    return this.mcpManager
      .getServers()
      .filter((server) => server.enabled)
      .map((server) => {
        const tools = this.toolCache.get(server.name)?.tools ?? [];
        return {
          name: server.name,
          tools: tools.map((tool) => ({
            name: tool.name,
            ...(tool.description ? { description: tool.description } : {}),
          })),
        };
      });
  }

  getServerSummaries(): Array<{
    name: string;
    enabled: boolean;
    contextSaving: boolean;
    toolCount: number;
  }> {
    return this.mcpManager.getServers().map((server) => ({
      name: server.name,
      enabled: server.enabled,
      contextSaving: server.contextSaving,
      toolCount: this.toolCache.get(server.name)?.tools.length ?? 0,
    }));
  }

  getActiveServers(): ManagedMcpServer[] {
    const configs = this.mcpManager.getActiveServers(this.activeMentions);
    const names = new Set(Object.keys(configs));
    return this.mcpManager
      .getServers()
      .filter((server) => names.has(server.name));
  }

  getActiveServerConfigs(): Record<string, McpServerConfig> {
    return this.mcpManager.getActiveServers(this.activeMentions);
  }

  async listCachedTools(serverName: string): Promise<McpTool[]> {
    const cached = this.toolCache.get(serverName);
    if (cached) {
      return cached.tools;
    }

    const server = this.findServer(serverName);
    if (!server) {
      return [];
    }

    try {
      const tools = await this.pool.listTools(server);
      this.toolCache.set(serverName, { tools, fetchedAt: Date.now() });
      return tools;
    } catch (error) {
      logger.warn(`Failed to list tools for MCP server "${serverName}"`, error);
      return [];
    }
  }

  async callTool(
    serverName: string,
    toolName: string,
    args: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<string> {
    const server = this.findServer(serverName);
    if (!server) {
      throw new Error(`Unknown MCP server: ${serverName}`);
    }
    if (!this.getActiveServerConfigs()[serverName]) {
      throw new Error(
        `MCP server "${serverName}" is not active for this turn (enable it in Settings → MCP)`,
      );
    }
    if (server.disabledTools?.includes(toolName)) {
      throw new Error(
        `Tool "${toolName}" is disabled for server "${serverName}"`,
      );
    }
    return this.pool.callTool(server, toolName, args, signal);
  }

  searchTools(query: string): Array<{ server: string; tool: McpTool }> {
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    const matches: Array<{ server: string; tool: McpTool }> = [];

    for (const server of this.getActiveServers()) {
      const tools = this.toolCache.get(server.name)?.tools ?? [];
      for (const tool of tools) {
        const haystack = `${tool.name} ${tool.description ?? ''}`.toLowerCase();
        if (
          terms.length === 0 ||
          terms.some((term) => haystack.includes(term))
        ) {
          matches.push({ server: server.name, tool });
        }
      }
    }

    return matches;
  }

  private findServer(name: string): ManagedMcpServer | undefined {
    return this.mcpManager.getServers().find((server) => server.name === name);
  }
}

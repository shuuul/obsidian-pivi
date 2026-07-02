import type { ToolSpec } from '@pivi/tools';

import { createMcpProxyToolSpec } from './createMcpProxyToolSpec';
import type { McpServerManager } from './McpServerManager';
import type { McpOAuthService } from './oauth/McpOAuthService';
import { PiMcpConnectionPool } from './PiMcpConnectionPool';
import type { McpTool } from './types';
import type { ManagedMcpServer, McpServerConfig } from './types';

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
    oauth: McpOAuthService | null = null,
  ) {
    this.pool = new PiMcpConnectionPool(oauth);
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
    this.pool.closeAll();
    this.toolCache.clear();
    this.proxyToolSpec = null;
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
      console.warn(
        `Pivi: failed to list tools for MCP server "${serverName}"`,
        error,
      );
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
        `MCP server "${serverName}" is not active for this turn (enable it or use /${serverName}/${toolName})`,
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
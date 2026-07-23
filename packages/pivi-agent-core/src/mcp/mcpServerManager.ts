import type { ParseDiagnostic } from '../foundation/configPublication';
import { extractMcpMentions, transformMcpMentions } from './mcpUtils';
import type { ManagedMcpServer, McpServerConfig } from './types';

export interface McpAvailabilitySummary {
  totalCount: number;
  enabledCount: number;
  alwaysActiveCount: number;
  contextSavingCount: number;
}

/** Storage interface for loading MCP servers. */
export interface McpStorageAdapter {
  load(): Promise<ManagedMcpServer[]>;
  loadWithDiagnostics?(): Promise<{
    servers: ManagedMcpServer[];
    diagnostics: ParseDiagnostic[];
    corruptPath?: string;
  }>;
}

export class McpServerManager {
  private servers: ManagedMcpServer[] = [];
  private loadDiagnostics: {
    diagnostics: readonly ParseDiagnostic[];
    corruptPath?: string;
  } | null = null;
  private storage: McpStorageAdapter;

  constructor(storage: McpStorageAdapter) {
    this.storage = storage;
  }

  async loadServers(): Promise<void> {
    if (this.storage.loadWithDiagnostics) {
      const result = await this.storage.loadWithDiagnostics();
      this.servers = result.servers;
      this.loadDiagnostics = result.diagnostics.length > 0 || result.corruptPath
        ? { diagnostics: result.diagnostics, corruptPath: result.corruptPath }
        : null;
      return;
    }
    this.servers = await this.storage.load();
    this.loadDiagnostics = null;
  }

  getServers(): ManagedMcpServer[] {
    return this.servers;
  }

  getLoadDiagnostics(): {
    diagnostics: readonly ParseDiagnostic[];
    corruptPath?: string;
  } | null {
    return this.loadDiagnostics;
  }

  getEnabledCount(): number {
    return this.servers.filter((s) => s.enabled).length;
  }

  getAvailabilitySummary(): McpAvailabilitySummary {
    let enabledCount = 0;
    let alwaysActiveCount = 0;
    let contextSavingCount = 0;

    for (const server of this.servers) {
      if (!server.enabled) continue;
      enabledCount += 1;
      if (server.contextSaving) {
        contextSavingCount += 1;
      } else {
        alwaysActiveCount += 1;
      }
    }

    return {
      totalCount: this.servers.length,
      enabledCount,
      alwaysActiveCount,
      contextSavingCount,
    };
  }

  /**
   * Get servers available to the proxy `mcp` tool for a turn.
   *
   * All settings-enabled servers participate. Slash `/server` tokens remain
   * optional prompt emphasis (via extract/transformMentions) and are not
   * required for discovery or tool calls. `mentionedNames` is retained for
   * call-site compatibility but no longer filters the active set.
   */
  getActiveServers(_mentionedNames?: Set<string>): Record<string, McpServerConfig> {
    const result: Record<string, McpServerConfig> = {};

    for (const server of this.servers) {
      if (!server.enabled) continue;
      result[server.name] = server.config;
    }

    return result;
  }

  /**
   * Get disabled MCP tools formatted for SDK disallowedTools option.
   *
   * Returns disabled tools from all settings-enabled servers.
   */
  getDisallowedMcpTools(_mentionedNames?: Set<string>): string[] {
    return this.collectDisallowedTools();
  }

  /**
   * Get all disabled MCP tools from ALL enabled servers (ignoring per-turn references).
   *
   * Used for persistent queries to pre-register all disabled tools upfront,
   * so slash-referencing servers doesn't require cold start.
   */
  getAllDisallowedMcpTools(): string[] {
    return this.collectDisallowedTools().sort();
  }

  private collectDisallowedTools(filter?: (server: ManagedMcpServer) => boolean): string[] {
    const disallowed = new Set<string>();

    for (const server of this.servers) {
      if (!server.enabled) continue;
      if (filter && !filter(server)) continue;
      if (!server.disabledTools || server.disabledTools.length === 0) continue;

      for (const tool of server.disabledTools) {
        const normalized = tool.trim();
        if (!normalized) continue;
        disallowed.add(`mcp__${server.name}__${normalized}`);
      }
    }

    return Array.from(disallowed);
  }

  hasServers(): boolean {
    return this.servers.length > 0;
  }

  getContextSavingServers(): ManagedMcpServer[] {
    return this.servers.filter((s) => s.enabled && s.contextSaving);
  }

  private getContextSavingNames(): Set<string> {
    return new Set(this.getContextSavingServers().map((s) => s.name));
  }

  /** Only matches against enabled servers with context-saving mode. */
  extractMentions(text: string): Set<string> {
    return extractMcpMentions(text, this.getContextSavingNames());
  }

  /**
   * Appends " MCP" after each valid /server or /server/tool token. Applied to API requests only, not shown in UI.
   */
  transformMentions(text: string): string {
    return transformMcpMentions(text, this.getContextSavingNames());
  }
}

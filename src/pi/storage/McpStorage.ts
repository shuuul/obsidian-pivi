import type { VaultFileAdapter } from '../../core/storage/VaultFileAdapter';
import type {
  ManagedMcpConfigFile,
  ManagedMcpServer,
  McpServerConfig,
} from '../../core/types';
import { DEFAULT_MCP_SERVER, isValidMcpServerConfig } from '../../core/types';
import { OBSIUS_MCP_CONFIG_PATH } from '../mcp/paths';

export { OBSIUS_MCP_CONFIG_PATH } from '../mcp/paths';

export class McpStorage {
  constructor(private readonly adapter: VaultFileAdapter) {}

  async load(): Promise<ManagedMcpServer[]> {
    const content = await this.readConfigContent();
    if (!content) {
      return [];
    }

    try {
      const file = JSON.parse(content) as ManagedMcpConfigFile;
      return this.parseServers(file);
    } catch {
      return [];
    }
  }

  async save(servers: ManagedMcpServer[]): Promise<void> {
    const mcpServers: Record<string, McpServerConfig> = {};
    const obsiusServers: Record<
      string,
      {
        enabled?: boolean;
        contextSaving?: boolean;
        disabledTools?: string[];
        description?: string;
        auth?: ManagedMcpServer['auth'];
        oauth?: ManagedMcpServer['oauth'];
        bearerToken?: string;
        bearerTokenEnv?: string;
      }
    > = {};

    for (const server of servers) {
      mcpServers[server.name] = server.config;

      const meta: {
        enabled?: boolean;
        contextSaving?: boolean;
        disabledTools?: string[];
        description?: string;
        auth?: ManagedMcpServer['auth'];
        oauth?: ManagedMcpServer['oauth'];
        bearerToken?: string;
        bearerTokenEnv?: string;
      } = {};

      if (server.enabled !== DEFAULT_MCP_SERVER.enabled) {
        meta.enabled = server.enabled;
      }
      if (server.contextSaving !== DEFAULT_MCP_SERVER.contextSaving) {
        meta.contextSaving = server.contextSaving;
      }
      const normalizedDisabledTools = server.disabledTools
        ?.map((tool) => tool.trim())
        .filter((tool) => tool.length > 0);
      if (normalizedDisabledTools && normalizedDisabledTools.length > 0) {
        meta.disabledTools = normalizedDisabledTools;
      }
      if (server.description) {
        meta.description = server.description;
      }
      if (server.auth && server.auth !== 'none') {
        meta.auth = server.auth;
      }
      if (server.oauth !== undefined) {
        meta.oauth = server.oauth;
      }
      if (server.bearerToken) {
        meta.bearerToken = server.bearerToken;
      }
      if (server.bearerTokenEnv) {
        meta.bearerTokenEnv = server.bearerTokenEnv;
      }

      if (Object.keys(meta).length > 0) {
        obsiusServers[server.name] = meta;
      }
    }

    let existing: Record<string, unknown> | null = null;
    if (await this.adapter.exists(OBSIUS_MCP_CONFIG_PATH)) {
      existing = await this.readJsonObject(OBSIUS_MCP_CONFIG_PATH);
    }

    const file: Record<string, unknown> = existing ? { ...existing } : {};
    file.mcpServers = mcpServers;

    const existingObsius =
      existing && typeof existing._obsius2 === 'object'
        ? (existing._obsius2 as Record<string, unknown>)
        : null;

    if (Object.keys(obsiusServers).length > 0) {
      file._obsius2 = { ...(existingObsius ?? {}), servers: obsiusServers };
    } else if (existingObsius) {
      const rest = { ...existingObsius };
      delete rest.servers;
      if (Object.keys(rest).length > 0) {
        file._obsius2 = rest;
      } else {
        delete file._obsius2;
      }
    } else {
      delete file._obsius2;
    }

    await this.adapter.ensureFolder('.obsius');
    await this.adapter.write(OBSIUS_MCP_CONFIG_PATH, `${JSON.stringify(file, null, 2)}\n`);
  }

  private async readConfigContent(): Promise<string | null> {
    if (await this.adapter.exists(OBSIUS_MCP_CONFIG_PATH)) {
      return this.adapter.read(OBSIUS_MCP_CONFIG_PATH);
    }
    return null;
  }

  private async readJsonObject(path: string): Promise<Record<string, unknown> | null> {
    try {
      const raw = await this.adapter.read(path);
      const parsed: unknown = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return null;
    }
    return null;
  }

  private parseServers(file: ManagedMcpConfigFile): ManagedMcpServer[] {
    if (!file.mcpServers || typeof file.mcpServers !== 'object') {
      return [];
    }

    const obsiusMeta = file._obsius2?.servers ?? {};
    const servers: ManagedMcpServer[] = [];

    for (const [name, config] of Object.entries(file.mcpServers)) {
      if (!isValidMcpServerConfig(config)) {
        continue;
      }

      const meta = (obsiusMeta[name] ?? {});
      const disabledTools = Array.isArray(meta.disabledTools)
        ? meta.disabledTools.filter((tool) => typeof tool === 'string')
        : undefined;
      const normalizedDisabledTools =
        disabledTools && disabledTools.length > 0 ? disabledTools : undefined;

      servers.push({
        name,
        config,
        enabled: meta.enabled ?? DEFAULT_MCP_SERVER.enabled,
        contextSaving: meta.contextSaving ?? DEFAULT_MCP_SERVER.contextSaving,
        disabledTools: normalizedDisabledTools,
        description: meta.description,
        auth: meta.auth,
        oauth: meta.oauth,
        bearerToken: meta.bearerToken,
        bearerTokenEnv: meta.bearerTokenEnv,
      });
    }

    return servers;
  }
}

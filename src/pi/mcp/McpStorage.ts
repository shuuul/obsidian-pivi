import type { SecretStorage } from "obsidian";

import type { FileStore } from "../../pi/storage/FileStore";
import type {
  ManagedMcpConfigFile,
  ManagedMcpServer,
  McpServerConfig,
  StoredMcpOAuthConfig,
} from "../../pi/types";
import { DEFAULT_MCP_SERVER, isValidMcpServerConfig } from "../../pi/types";
import { PIVI_MCP_CONFIG_PATH } from "../mcp/paths";

export { PIVI_MCP_CONFIG_PATH } from "../mcp/paths";

type McpSecretKind = "bearer-token" | "client-secret";

function isSecretStorageAvailable(
  secretStorage: SecretStorage | undefined,
): secretStorage is SecretStorage {
  return (
    !!secretStorage &&
    typeof secretStorage.getSecret === "function" &&
    typeof secretStorage.setSecret === "function" &&
    typeof secretStorage.listSecrets === "function"
  );
}

function encodeSecretName(name: string): string {
  return Array.from(new TextEncoder().encode(name))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function getMcpSecretId(serverName: string, kind: McpSecretKind): string {
  return `pivi-mcp-${encodeSecretName(serverName)}-${kind}`;
}

function stripOAuthClientSecret(
  oauth: ManagedMcpServer["oauth"],
): StoredMcpOAuthConfig | false | undefined {
  if (oauth === false || oauth === undefined) {
    return oauth;
  }
  const { clientSecret: _clientSecret, ...stored } = oauth;
  return stored;
}

function getExistingServerNames(
  existing: Record<string, unknown> | null,
): string[] {
  const raw = existing?.mcpServers;
  if (!raw || typeof raw !== "object") {
    return [];
  }
  return Object.keys(raw);
}

export class McpStorage {
  constructor(
    private readonly adapter: FileStore,
    private readonly secretStorage?: SecretStorage,
  ) {}

  async load(): Promise<ManagedMcpServer[]> {
    const content = await this.readConfigContent();
    if (!content) {
      return [];
    }

    let file: ManagedMcpConfigFile;
    try {
      file = JSON.parse(content) as ManagedMcpConfigFile;
    } catch {
      return [];
    }

    const servers = this.parseServers(file);
    await this.hydrateSecretsAndMigrateLegacyPlaintext(servers);
    return servers;
  }

  async save(servers: ManagedMcpServer[]): Promise<void> {
    let existing: Record<string, unknown> | null = null;
    if (await this.adapter.exists(PIVI_MCP_CONFIG_PATH)) {
      existing = await this.readJsonObject(PIVI_MCP_CONFIG_PATH);
    }

    const nextServerNames = new Set(servers.map((server) => server.name));
    for (const existingName of getExistingServerNames(existing)) {
      if (!nextServerNames.has(existingName)) {
        this.clearServerSecrets(existingName);
      }
    }

    const mcpServers: Record<string, McpServerConfig> = {};
    const piviServers: Record<
      string,
      {
        enabled?: boolean;
        contextSaving?: boolean;
        disabledTools?: string[];
        description?: string;
        auth?: ManagedMcpServer["auth"];
        oauth?: StoredMcpOAuthConfig | false;
        bearerTokenEnv?: string;
      }
    > = {};

    for (const server of servers) {
      mcpServers[server.name] = server.config;
      this.persistServerSecrets(server);

      const meta: {
        enabled?: boolean;
        contextSaving?: boolean;
        disabledTools?: string[];
        description?: string;
        auth?: ManagedMcpServer["auth"];
        oauth?: StoredMcpOAuthConfig | false;
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
      if (server.auth && server.auth !== "none") {
        meta.auth = server.auth;
      }
      if (server.oauth !== undefined) {
        meta.oauth = stripOAuthClientSecret(server.oauth);
      }
      if (server.bearerTokenEnv) {
        meta.bearerTokenEnv = server.bearerTokenEnv;
      }

      if (Object.keys(meta).length > 0) {
        piviServers[server.name] = meta;
      }
    }

    const file: Record<string, unknown> = existing ? { ...existing } : {};
    file.mcpServers = mcpServers;

    const existingPivi =
      existing && typeof existing._pivi === "object"
        ? (existing._pivi as Record<string, unknown>)
        : null;

    if (Object.keys(piviServers).length > 0) {
      file._pivi = { ...(existingPivi ?? {}), servers: piviServers };
    } else if (existingPivi) {
      const rest = { ...existingPivi };
      delete rest.servers;
      if (Object.keys(rest).length > 0) {
        file._pivi = rest;
      } else {
        delete file._pivi;
      }
    } else {
      delete file._pivi;
    }

    await this.adapter.ensureFolder(".pivi");
    await this.adapter.write(
      PIVI_MCP_CONFIG_PATH,
      `${JSON.stringify(file, null, 2)}\n`,
    );
  }

  private async readConfigContent(): Promise<string | null> {
    if (await this.adapter.exists(PIVI_MCP_CONFIG_PATH)) {
      return this.adapter.read(PIVI_MCP_CONFIG_PATH);
    }
    return null;
  }

  private async readJsonObject(
    path: string,
  ): Promise<Record<string, unknown> | null> {
    try {
      const raw = await this.adapter.read(path);
      const parsed: unknown = JSON.parse(raw);
      if (parsed && typeof parsed === "object") {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return null;
    }
    return null;
  }

  private getStoredSecret(
    serverName: string,
    kind: McpSecretKind,
  ): string | undefined {
    if (!isSecretStorageAvailable(this.secretStorage)) {
      return undefined;
    }
    const value = this.secretStorage.getSecret(
      getMcpSecretId(serverName, kind),
    );
    return typeof value === "string" && value.length > 0 ? value : undefined;
  }

  private setStoredSecret(
    serverName: string,
    kind: McpSecretKind,
    value: string,
  ): void {
    if (!isSecretStorageAvailable(this.secretStorage)) {
      throw new Error("MCP secrets require Obsidian keychain storage.");
    }
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      this.clearStoredSecret(serverName, kind);
      return;
    }
    this.secretStorage.setSecret(getMcpSecretId(serverName, kind), trimmed);
  }

  private clearStoredSecret(serverName: string, kind: McpSecretKind): void {
    if (!isSecretStorageAvailable(this.secretStorage)) {
      return;
    }
    this.secretStorage.setSecret(getMcpSecretId(serverName, kind), "");
  }

  private clearServerSecrets(serverName: string): void {
    this.clearStoredSecret(serverName, "bearer-token");
    this.clearStoredSecret(serverName, "client-secret");
  }

  private persistServerSecrets(server: ManagedMcpServer): void {
    if (server.auth === "bearer") {
      if (server.bearerToken) {
        this.setStoredSecret(server.name, "bearer-token", server.bearerToken);
      } else {
        this.clearStoredSecret(server.name, "bearer-token");
      }
    } else {
      this.clearStoredSecret(server.name, "bearer-token");
    }

    if (server.oauth && typeof server.oauth === "object") {
      if (server.oauth.clientSecret) {
        this.setStoredSecret(
          server.name,
          "client-secret",
          server.oauth.clientSecret,
        );
      } else {
        this.clearStoredSecret(server.name, "client-secret");
      }
    } else {
      this.clearStoredSecret(server.name, "client-secret");
    }
  }

  private async hydrateSecretsAndMigrateLegacyPlaintext(
    servers: ManagedMcpServer[],
  ): Promise<void> {
    if (!isSecretStorageAvailable(this.secretStorage)) {
      return;
    }

    let migratedLegacyPlaintext = false;

    for (const server of servers) {
      const legacyBearerToken = server.bearerToken?.trim();
      if (legacyBearerToken) {
        this.setStoredSecret(server.name, "bearer-token", legacyBearerToken);
        migratedLegacyPlaintext = true;
      }
      const storedBearerToken = this.getStoredSecret(
        server.name,
        "bearer-token",
      );
      if (server.auth === "bearer" && storedBearerToken) {
        server.bearerToken = storedBearerToken;
      }

      if (server.oauth && typeof server.oauth === "object") {
        const legacyClientSecret = server.oauth.clientSecret?.trim();
        if (legacyClientSecret) {
          this.setStoredSecret(
            server.name,
            "client-secret",
            legacyClientSecret,
          );
          migratedLegacyPlaintext = true;
        }
        const storedClientSecret = this.getStoredSecret(
          server.name,
          "client-secret",
        );
        if (storedClientSecret) {
          server.oauth = {
            ...server.oauth,
            clientSecret: storedClientSecret,
          };
        }
      }
    }

    if (migratedLegacyPlaintext) {
      await this.save(servers);
    }
  }

  private parseServers(file: ManagedMcpConfigFile): ManagedMcpServer[] {
    if (!file.mcpServers || typeof file.mcpServers !== "object") {
      return [];
    }

    const piviMeta = file._pivi?.servers ?? {};
    const servers: ManagedMcpServer[] = [];

    for (const [name, config] of Object.entries(file.mcpServers)) {
      if (!isValidMcpServerConfig(config)) {
        continue;
      }

      const meta = piviMeta[name] ?? {};
      const disabledTools = Array.isArray(meta.disabledTools)
        ? meta.disabledTools.filter((tool) => typeof tool === "string")
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

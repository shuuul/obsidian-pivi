import {
  encodeUtf8Hex,
  listObsidianSecretIds,
  stableProviderIdDigest,
} from '../auth/providerSecretStorage';
import {
  type ParseDiagnostic,
  parseJsonObjectWithDiagnostics,
  preserveCorruptArtifact,
  runSerializedSave,
  writeFileAtomically,
} from '../foundation/configPublication';
import { listMcpValueSecretIds as listConfigMcpValueSecretIds } from '../foundation/configValueSource';
import type { SyncSecretStore } from '../ports';
import {
  assertValidMcpServerName,
  createMcpServerMap,
  isValidMcpServerName,
  setMcpServerMapEntry,
  validateMcpRemoteUrl,
} from './mcpValidation';
import {
  inputMapToDrafts,
  isLegacyPlainStringMap,
  type McpStoredValueMap,
  normalizeMcpStoredValueMap,
  stageMcpValueSecrets,
} from './mcpValueSources';
import { PIVI_MCP_CONFIG_PATH } from './paths';
import type { FileStore } from './ports';
import type {
  ManagedMcpConfigFile,
  ManagedMcpServer,
  McpServerConfig,
  StoredMcpOAuthConfig,
} from './types';
import {
  DEFAULT_MCP_SERVER,
  getMcpServerType,
  isValidMcpServerConfig,
} from './types';

export { PIVI_MCP_CONFIG_PATH } from './paths';

type McpSecretKind = 'bearer-token' | 'client-secret';

export interface McpLoadResult {
  servers: ManagedMcpServer[];
  diagnostics: ParseDiagnostic[];
  corruptPath?: string;
}

export class McpConfigLoadError extends Error {
  constructor(
    message: string,
    readonly diagnostics: readonly ParseDiagnostic[],
    readonly corruptPath?: string,
  ) {
    super(message);
    this.name = 'McpConfigLoadError';
  }
}

function isSecretStorageAvailable(
  secretStorage: SyncSecretStore | undefined,
): secretStorage is SyncSecretStore {
  return (
    !!secretStorage
    && typeof secretStorage.getSecret === 'function'
    && typeof secretStorage.setSecret === 'function'
    && typeof secretStorage.listSecrets === 'function'
  );
}

function encodeSecretName(name: string): string {
  return encodeUtf8Hex(name);
}

function directMcpSecretId(serverName: string, kind: McpSecretKind): string {
  return `pivi-mcp-${encodeSecretName(serverName)}-${kind}`;
}

function digestMcpSecretId(serverName: string, kind: McpSecretKind): string {
  return `pivi-mcp-d-${stableProviderIdDigest(serverName)}-${kind}`;
}

function listMcpSecretIds(serverName: string, kind: McpSecretKind): readonly string[] {
  return listObsidianSecretIds(
    directMcpSecretId(serverName, kind),
    digestMcpSecretId(serverName, kind),
  );
}

function getMcpSecretId(serverName: string, kind: McpSecretKind): string {
  return listMcpSecretIds(serverName, kind)[0]!;
}

function stripOAuthClientSecret(
  oauth: ManagedMcpServer['oauth'],
): StoredMcpOAuthConfig | false | undefined {
  if (oauth === false || oauth === undefined) {
    return oauth;
  }
  const stored = { ...oauth } as StoredMcpOAuthConfig;
  // @ts-expect-error clientSecret is deleted to avoid saving in plain text
  delete stored.clientSecret;
  return stored;
}

function getExistingServerNames(
  existing: Record<string, unknown> | null,
): string[] {
  const raw = existing?.mcpServers;
  if (!raw || typeof raw !== 'object') {
    return [];
  }
  return Object.keys(raw);
}

function getPreviousStoredMap(
  previous: McpServerConfig | undefined,
  channel: 'env' | 'headers',
): McpStoredValueMap | undefined {
  if (!previous) {
    return undefined;
  }
  const raw = channel === 'env'
    ? (previous as { env?: unknown }).env
    : (previous as { headers?: unknown }).headers;
  return normalizeMcpStoredValueMap(raw);
}

function needsStructuredMigration(config: McpServerConfig): boolean {
  if (getMcpServerType(config) === 'stdio') {
    const env = (config as { env?: unknown }).env;
    return env !== undefined && isLegacyPlainStringMap(env);
  }
  const headers = (config as { headers?: unknown }).headers;
  return headers !== undefined && isLegacyPlainStringMap(headers);
}

export class McpStorage {
  constructor(
    private readonly adapter: FileStore,
    private readonly secretStorage?: SyncSecretStore,
  ) {}

  async loadWithDiagnostics(): Promise<McpLoadResult> {
    const content = await this.readConfigContent();
    if (content === null) {
      return { servers: [], diagnostics: [] };
    }

    const parsed = parseJsonObjectWithDiagnostics(PIVI_MCP_CONFIG_PATH, content);
    if (!parsed.ok) {
      const corruptPath = await preserveCorruptArtifact(
        this.adapter,
        PIVI_MCP_CONFIG_PATH,
        parsed.rawContent,
      );
      return {
        servers: [],
        diagnostics: parsed.diagnostics,
        corruptPath,
      };
    }

    const file = parsed.value as unknown as ManagedMcpConfigFile;
    const servers = this.parseServers(file);
    const migrated = await this.migrateLoadedServers(servers);
    return { servers: migrated, diagnostics: [] };
  }

  async load(): Promise<ManagedMcpServer[]> {
    const result = await this.loadWithDiagnostics();
    if (result.corruptPath) {
      throw new McpConfigLoadError(
        result.diagnostics.map((item) => item.message).join(' '),
        result.diagnostics,
        result.corruptPath,
      );
    }
    return result.servers;
  }

  async save(servers: ManagedMcpServer[]): Promise<void> {
    await runSerializedSave(PIVI_MCP_CONFIG_PATH, () => this.saveInternal(servers));
  }

  private async saveInternal(servers: ManagedMcpServer[]): Promise<void> {
    let existing: Record<string, unknown> | null = null;
    if (await this.adapter.exists(PIVI_MCP_CONFIG_PATH)) {
      const content = await this.readConfigContent();
      if (content !== null) {
        const parsed = parseJsonObjectWithDiagnostics(PIVI_MCP_CONFIG_PATH, content);
        if (parsed.ok) {
          existing = parsed.value;
        }
      }
    }

    const existingServers = this.parseExistingConfigs(existing);
    const nextServerNames = new Set(servers.map((server) => server.name));
    const obsoleteSecretIds: string[] = [];

    for (const existingName of getExistingServerNames(existing)) {
      if (!nextServerNames.has(existingName)) {
        obsoleteSecretIds.push(...this.listServerSecretIds(existingName));
        const previousConfig = existingServers.get(existingName);
        obsoleteSecretIds.push(...this.listValueSecretIds(existingName, previousConfig));
      }
    }

    const mcpServers = createMcpServerMap<McpServerConfig>();
    const piviServers = createMcpServerMap<{
      enabled?: boolean;
      contextSaving?: boolean;
      disabledTools?: string[];
      description?: string;
      auth?: ManagedMcpServer['auth'];
      oauth?: StoredMcpOAuthConfig | false;
      bearerTokenEnv?: string;
    }>();

    for (const server of servers) {
      const normalizedName = assertValidMcpServerName(server.name);
      const previousConfig = existingServers.get(normalizedName);
      const prepared = this.prepareServerConfig(
        normalizedName,
        server.config,
        previousConfig,
      );
      obsoleteSecretIds.push(...prepared.obsoleteSecretIds);
      setMcpServerMapEntry(mcpServers, normalizedName, prepared.config);
      obsoleteSecretIds.push(...this.stageBearerAndOAuthSecrets({ ...server, name: normalizedName }));

      const meta: {
        enabled?: boolean;
        contextSaving?: boolean;
        disabledTools?: string[];
        description?: string;
        auth?: ManagedMcpServer['auth'];
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
      if (server.auth && server.auth !== 'none') {
        meta.auth = server.auth;
      }
      if (server.oauth !== undefined) {
        meta.oauth = stripOAuthClientSecret(server.oauth);
      }
      if (server.bearerTokenEnv) {
        meta.bearerTokenEnv = server.bearerTokenEnv;
      }

      if (Object.keys(meta).length > 0) {
        setMcpServerMapEntry(piviServers, normalizedName, meta);
      }
    }

    const file: Record<string, unknown> = existing ? { ...existing } : {};
    file.mcpServers = mcpServers;

    const existingPivi =
      existing && typeof existing._pivi === 'object'
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

    await this.adapter.ensureFolder('.pivi');
    await writeFileAtomically(
      this.adapter,
      PIVI_MCP_CONFIG_PATH,
      `${JSON.stringify(file, null, 2)}\n`,
    );

    if (isSecretStorageAvailable(this.secretStorage)) {
      const uniqueObsolete = [...new Set(obsoleteSecretIds)];
      for (const secretId of uniqueObsolete) {
        if (this.secretStorage.deleteSecret) {
          this.secretStorage.deleteSecret(secretId);
        } else {
          this.secretStorage.setSecret(secretId, '');
        }
      }
    }
  }

  private parseExistingConfigs(
    existing: Record<string, unknown> | null,
  ): Map<string, McpServerConfig> {
    const map = new Map<string, McpServerConfig>();
    const raw = existing?.mcpServers;
    if (!raw || typeof raw !== 'object') {
      return map;
    }
    for (const [name, config] of Object.entries(raw)) {
      if (isValidMcpServerName(name) && isValidMcpServerConfig(config)) {
        map.set(name, config);
      }
    }
    return map;
  }

  private prepareServerConfig(
    serverName: string,
    config: McpServerConfig,
    previousConfig: McpServerConfig | undefined,
  ): { config: McpServerConfig; obsoleteSecretIds: string[] } {
    if (!isSecretStorageAvailable(this.secretStorage)) {
      return {
        config: normalizeManagedServerConfig(config),
        obsoleteSecretIds: [],
      };
    }

    const obsoleteSecretIds: string[] = [];
    if (getMcpServerType(config) === 'stdio') {
      const stdio = config as { command: string; args?: string[]; env?: unknown };
      const previousEnv = getPreviousStoredMap(previousConfig, 'env');
      const envDrafts = inputMapToDrafts(
        stdio.env as McpStoredValueMap | Record<string, string> | undefined,
        'env',
      );
      const staged = stageMcpValueSecrets(
        this.secretStorage,
        serverName,
        'env',
        envDrafts,
        previousEnv,
      );
      obsoleteSecretIds.push(...staged.obsoleteSecretIds);
      const next: McpServerConfig = {
        command: stdio.command,
        ...(stdio.args && stdio.args.length > 0 ? { args: stdio.args } : {}),
        ...(Object.keys(staged.stored).length > 0 ? { env: staged.stored } : {}),
      };
      return { config: next, obsoleteSecretIds };
    }

    const remote = config as { url: string; type?: 'sse' | 'http'; headers?: unknown };
    const url = validateMcpRemoteUrl(remote.url);
    const previousHeaders = getPreviousStoredMap(previousConfig, 'headers');
    const headerDrafts = inputMapToDrafts(
      remote.headers as McpStoredValueMap | Record<string, string> | undefined,
      'header',
    );
    const staged = stageMcpValueSecrets(
      this.secretStorage,
      serverName,
      'header',
      headerDrafts,
      previousHeaders,
    );
    obsoleteSecretIds.push(...staged.obsoleteSecretIds);
    const headers = Object.keys(staged.stored).length > 0 ? staged.stored : undefined;
    if (remote.type === 'sse') {
      return {
        config: { type: 'sse', url, ...(headers ? { headers } : {}) },
        obsoleteSecretIds,
      };
    }
    return {
      config: { type: 'http', url, ...(headers ? { headers } : {}) },
      obsoleteSecretIds,
    };
  }

  private async migrateLoadedServers(servers: ManagedMcpServer[]): Promise<ManagedMcpServer[]> {
    await this.hydrateBearerAndOAuthSecrets(servers);

    const needsRewrite = servers.some((server) => needsStructuredMigration(server.config));
    if (!needsRewrite) {
      return servers;
    }

    if (!isSecretStorageAvailable(this.secretStorage)) {
      return servers;
    }

    for (const server of servers) {
      if (!needsStructuredMigration(server.config)) {
        continue;
      }
      const prepared = this.prepareServerConfig(server.name, server.config, server.config);
      server.config = prepared.config;
    }

    await this.saveInternal(servers);
    await this.hydrateBearerAndOAuthSecrets(servers);
    return servers;
  }

  private async readConfigContent(): Promise<string | null> {
    if (await this.adapter.exists(PIVI_MCP_CONFIG_PATH)) {
      return this.adapter.read(PIVI_MCP_CONFIG_PATH);
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
    if (typeof value === 'string' && value.length > 0) {
      return value;
    }
    for (const secretId of listMcpSecretIds(serverName, kind).slice(1)) {
      const fallback = this.secretStorage.getSecret(secretId);
      if (typeof fallback === 'string' && fallback.length > 0) {
        return fallback;
      }
    }
    return undefined;
  }

  private setStoredSecret(
    serverName: string,
    kind: McpSecretKind,
    value: string,
  ): void {
    if (!isSecretStorageAvailable(this.secretStorage)) {
      throw new Error('MCP secrets require Obsidian keychain storage.');
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
    for (const secretId of listMcpSecretIds(serverName, kind)) {
      this.secretStorage.setSecret(secretId, '');
    }
  }

  private listServerSecretIds(serverName: string): string[] {
    return [
      ...listMcpSecretIds(serverName, 'bearer-token'),
      ...listMcpSecretIds(serverName, 'client-secret'),
    ];
  }

  private listValueSecretIds(
    serverName: string,
    config: McpServerConfig | undefined,
  ): string[] {
    if (!config) {
      return [];
    }
    const ids: string[] = [];
    if (getMcpServerType(config) === 'stdio') {
      const env = normalizeMcpStoredValueMap((config as { env?: unknown }).env);
      if (env) {
        for (const [key, ref] of Object.entries(env)) {
          if (ref.kind === 'secret') {
            ids.push(...listConfigMcpValueSecretIds(serverName, 'env', key));
          }
        }
      }
      return ids;
    }
    const headers = normalizeMcpStoredValueMap((config as { headers?: unknown }).headers);
    if (headers) {
      for (const [key, ref] of Object.entries(headers)) {
        if (ref.kind === 'secret') {
          ids.push(...listConfigMcpValueSecretIds(serverName, 'header', key));
        }
      }
    }
    return ids;
  }

  private stageBearerAndOAuthSecrets(server: ManagedMcpServer): string[] {
    const obsoleteSecretIds: string[] = [];
    if (server.auth === 'bearer') {
      if (server.bearerToken) {
        this.setStoredSecret(server.name, 'bearer-token', server.bearerToken);
      }
    } else {
      obsoleteSecretIds.push(...listMcpSecretIds(server.name, 'bearer-token'));
    }

    if (server.oauth && typeof server.oauth === 'object') {
      if (server.oauth.clientSecret) {
        this.setStoredSecret(
          server.name,
          'client-secret',
          server.oauth.clientSecret,
        );
      }
    } else {
      obsoleteSecretIds.push(...listMcpSecretIds(server.name, 'client-secret'));
    }
    return obsoleteSecretIds;
  }

  private async hydrateBearerAndOAuthSecrets(
    servers: ManagedMcpServer[],
  ): Promise<void> {
    if (!isSecretStorageAvailable(this.secretStorage)) {
      return;
    }

    let migratedLegacyPlaintext = false;

    for (const server of servers) {
      const legacyBearerToken = server.bearerToken?.trim();
      if (legacyBearerToken) {
        this.setStoredSecret(server.name, 'bearer-token', legacyBearerToken);
        migratedLegacyPlaintext = true;
      }
      const storedBearerToken = this.getStoredSecret(
        server.name,
        'bearer-token',
      );
      if (server.auth === 'bearer' && storedBearerToken) {
        server.bearerToken = storedBearerToken;
      }

      if (server.oauth && typeof server.oauth === 'object') {
        const legacyClientSecret = server.oauth.clientSecret?.trim();
        if (legacyClientSecret) {
          this.setStoredSecret(
            server.name,
            'client-secret',
            legacyClientSecret,
          );
          migratedLegacyPlaintext = true;
        }
        const storedClientSecret = this.getStoredSecret(
          server.name,
          'client-secret',
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
      await this.saveInternal(servers);
      for (const server of servers) {
        server.bearerToken = undefined;
        if (server.oauth && typeof server.oauth === 'object') {
          const { clientSecret: _removed, ...rest } = server.oauth;
          server.oauth = rest;
        }
        const storedBearerToken = this.getStoredSecret(server.name, 'bearer-token');
        if (server.auth === 'bearer' && storedBearerToken) {
          server.bearerToken = storedBearerToken;
        }
        const storedClientSecret = this.getStoredSecret(server.name, 'client-secret');
        if (server.oauth && typeof server.oauth === 'object' && storedClientSecret) {
          server.oauth = { ...server.oauth, clientSecret: storedClientSecret };
        }
      }
    }
  }

  private parseServers(file: ManagedMcpConfigFile): ManagedMcpServer[] {
    if (!file.mcpServers || typeof file.mcpServers !== 'object') {
      return [];
    }

    const piviMeta = file._pivi?.servers ?? {};
    const servers: ManagedMcpServer[] = [];

    for (const [name, config] of Object.entries(file.mcpServers)) {
      if (!isValidMcpServerName(name) || !isValidMcpServerConfig(config)) {
        continue;
      }

      const meta = piviMeta[name] ?? {};
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

function normalizeManagedServerConfig(config: McpServerConfig): McpServerConfig {
  if (getMcpServerType(config) === 'stdio') {
    const stdio = config as { command: string; args?: string[]; env?: unknown };
    const env = normalizeMcpStoredValueMap(stdio.env);
    return {
      command: stdio.command,
      ...(stdio.args && stdio.args.length > 0 ? { args: stdio.args } : {}),
      ...(env ? { env } : {}),
    };
  }
  const remote = config as { url: string; type?: 'sse' | 'http'; headers?: unknown };
  const url = validateMcpRemoteUrl(remote.url);
  const headers = normalizeMcpStoredValueMap(remote.headers);
  if (remote.type === 'sse') {
    return { type: 'sse', url, ...(headers ? { headers } : {}) };
  }
  return { type: 'http', url, ...(headers ? { headers } : {}) };
}

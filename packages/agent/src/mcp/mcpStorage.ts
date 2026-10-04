import {
  clearSyncSecret,
  stableProviderIdDigest,
} from '../auth/providerSecretStorage';
import {
  type ParseDiagnostic,
  parseJsonObjectWithDiagnostics,
  preserveCorruptArtifact,
  runSerializedSave,
  writeFileAtomically,
} from '../config/publication';
import { listMcpValueSecretIds as listConfigMcpValueSecretIds } from '../config/valueSource';
import { PluginLogger } from '../logging/pluginLogger';
import type { SyncSecretStore } from '../ports';
import type { FileStore } from '../ports';
import {
  assertValidMcpServerName,
  createMcpServerMap,
  isValidMcpServerName,
  setMcpServerMapEntry,
  validateMcpRemoteUrl,
} from './mcpValidation';
import {
  inputMapToDrafts,
  type McpStoredValueMap,
  normalizeMcpStoredValueMap,
  stageMcpValueSecrets,
} from './mcpValueSources';
import { PIVI_MCP_CONFIG_PATH } from './paths';
import type {
  ManagedMcpConfigFile,
  ManagedMcpServer,
  McpServerConfig,
} from './types';
import {
  DEFAULT_MCP_SERVER,
  getMcpServerType,
} from './types';

export { PIVI_MCP_CONFIG_PATH } from './paths';
import {
  buildPiviServerMeta,
  createMcpSecretTransaction,
  getExistingServerNames,
  getMcpSecretId,
  getPreviousStoredMap,
  isSecretStorageAvailable,
  listMcpSecretIds,
  McpConfigLoadError,
  type McpSecretKind,
  McpStorageStateChangedError,
  needsStructuredMigration,
  normalizeManagedServerConfig,
  type PiviServerMeta,
  readPersistedServerConfig,
} from './mcpStorageRecords';
export {
  listMcpServerSecretIds,
  McpConfigLoadError,
  McpStorageStateChangedError,
} from './mcpStorageRecords';

export interface McpLoadResult {
  servers: ManagedMcpServer[];
  diagnostics: ParseDiagnostic[];
  corruptPath?: string;
  /** Legacy SSE servers rewritten to disabled Streamable HTTP entries during this load. */
  legacySseServers?: string[];
}

export interface McpSaveResult {
  revision: string;
  cleanupFailures: Array<{ target: string; message: string }>;
}

const logger = new PluginLogger('McpStorage');

export class McpStorage {
  private transactionSecretStorage: SyncSecretStore | undefined;

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
    const legacySseServers: string[] = [];
    const servers = this.parseServers(file, legacySseServers);
    const migrated = await this.migrateLoadedServers(servers, legacySseServers.length > 0);
    return {
      servers: migrated,
      diagnostics: [],
      ...(legacySseServers.length > 0 ? { legacySseServers } : {}),
    };
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

  /** Read authoritative persisted configuration without migration, secret hydration, or writes. */
  async loadSnapshot(): Promise<ManagedMcpServer[]> {
    return (await this.loadRevisionedSnapshot()).servers;
  }

  async loadRevisionedSnapshot(): Promise<{ servers: ManagedMcpServer[]; revision: string }> {
    const content = await this.readConfigContent();
    if (content === null) {
      return { servers: [], revision: this.revisionOfContent(null) };
    }
    const parsed = parseJsonObjectWithDiagnostics(PIVI_MCP_CONFIG_PATH, content);
    if (!parsed.ok) {
      throw new McpConfigLoadError(
        parsed.diagnostics.map((item) => item.message).join(' '),
        parsed.diagnostics,
      );
    }
    const servers = this.parseServers(parsed.value as unknown as ManagedMcpConfigFile);
    return { servers, revision: this.revisionOfContent(content, servers) };
  }

  async saveIfRevision(servers: ManagedMcpServer[], expectedRevision: string): Promise<McpSaveResult> {
    return runSerializedSave(PIVI_MCP_CONFIG_PATH, async () => {
      const authoritative = await this.readConfigContent();
      if (this.revisionOfContent(authoritative) !== expectedRevision) {
        throw new McpStorageStateChangedError();
      }
      return this.saveTransaction(servers);
    });
  }

  async save(servers: ManagedMcpServer[]): Promise<void> {
    await runSerializedSave(PIVI_MCP_CONFIG_PATH, async () => {
      await this.saveTransaction(servers);
    });
  }

  private async saveTransaction(servers: ManagedMcpServer[]): Promise<McpSaveResult> {
    const transaction = createMcpSecretTransaction(this.secretStorage);
    this.transactionSecretStorage = transaction?.storage;
    // Rollback staged secrets only before mcp.json publication. After publish the
    // durable config references those secrets, so undoing them would desync storage.
    let published = false;
    try {
      return await this.saveInternal(servers, () => {
        published = true;
      });
    } catch (error) {
      if (!published) {
        const rollbackFailures = transaction?.rollback() ?? [];
        if (rollbackFailures.length > 0) {
          logger.warn('MCP secret rollback had failures', rollbackFailures);
        }
      }
      throw error;
    } finally {
      this.transactionSecretStorage = undefined;
    }
  }

  private revisionOfContent(
    content: string | null,
    parsedServers?: readonly ManagedMcpServer[],
  ): string {
    let servers = parsedServers;
    if (!servers && content !== null) {
      const parsed = parseJsonObjectWithDiagnostics(PIVI_MCP_CONFIG_PATH, content);
      if (parsed.ok) {
        servers = this.parseServers(parsed.value as unknown as ManagedMcpConfigFile);
      }
    }
    const directSecrets = [...(servers ?? [])]
      .sort((left, right) => left.name.localeCompare(right.name))
      .map(server => [
        server.name,
        this.getStoredSecret(server.name, 'bearer-token') ?? null,
        this.getStoredSecret(server.name, 'client-secret') ?? null,
      ]);
    return stableProviderIdDigest(JSON.stringify([
      content === null ? '<absent>' : content,
      directSecrets,
    ]));
  }

  private async readExistingConfigObject(): Promise<Record<string, unknown> | null> {
    if (!await this.adapter.exists(PIVI_MCP_CONFIG_PATH)) {
      return null;
    }
    const content = await this.readConfigContent();
    if (content === null) {
      return null;
    }
    const parsed = parseJsonObjectWithDiagnostics(PIVI_MCP_CONFIG_PATH, content);
    return parsed.ok ? parsed.value : null;
  }

  private async saveInternal(
    servers: ManagedMcpServer[],
    onPublished?: () => void,
  ): Promise<McpSaveResult> {
    const existing = await this.readExistingConfigObject();

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
    const piviServers = createMcpServerMap<PiviServerMeta>();

    for (const server of servers) {
      const normalizedName = assertValidMcpServerName(server.name);
      const previousConfig = existingServers.get(normalizedName);
      if (
        previousConfig
        && getMcpServerType(previousConfig) !== getMcpServerType(server.config)
      ) {
        // A channel switch cannot reuse any value from the old channel. Retire
        // all of its secret IDs only after the replacement config is published.
        obsoleteSecretIds.push(...this.listValueSecretIds(normalizedName, previousConfig));
      }
      const prepared = this.prepareServerConfig(
        normalizedName,
        server.config,
        previousConfig,
      );
      obsoleteSecretIds.push(...prepared.obsoleteSecretIds);
      setMcpServerMapEntry(mcpServers, normalizedName, prepared.config);
      obsoleteSecretIds.push(...this.stageBearerAndOAuthSecrets({ ...server, name: normalizedName }));

      const meta = buildPiviServerMeta(server);
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

    // Authoritative CAS revision is the digest of the exact bytes we publish.
    // Do not re-read the file afterward — a post-publication read fault must not
    // undo staged secrets that the durable config now references.
    const publishedContent = `${JSON.stringify(file, null, 2)}\n`;
    await this.adapter.ensureFolder('.pivi');
    await writeFileAtomically(
      this.adapter,
      PIVI_MCP_CONFIG_PATH,
      publishedContent,
    );
    onPublished?.();
    const cleanupFailures: McpSaveResult['cleanupFailures'] = [];
    if (isSecretStorageAvailable(this.secretStorage)) {
      const uniqueObsolete = [...new Set(obsoleteSecretIds)];
      for (const secretId of uniqueObsolete) {
        try {
          if (this.secretStorage.deleteSecret) {
            this.secretStorage.deleteSecret(secretId);
          } else {
            this.secretStorage.setSecret(secretId, '');
          }
        } catch (cause) {
          cleanupFailures.push({
            target: secretId,
            message: cause instanceof Error ? cause.message : 'Secret cleanup failed',
          });
        }
      }
    }
    return {
      revision: this.revisionOfContent(publishedContent),
      cleanupFailures: cleanupFailures.slice(0, 20),
    };
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
      const persisted = isValidMcpServerName(name) ? readPersistedServerConfig(config) : null;
      if (persisted) {
        map.set(name, persisted.config);
      }
    }
    return map;
  }

  private prepareServerConfig(
    serverName: string,
    config: McpServerConfig,
    previousConfig: McpServerConfig | undefined,
  ): { config: McpServerConfig; obsoleteSecretIds: string[] } {
    const secretStorage = this.transactionSecretStorage ?? this.secretStorage;
    if (!isSecretStorageAvailable(secretStorage)) {
      return {
        config: normalizeManagedServerConfig(config),
        obsoleteSecretIds: [],
      };
    }

    const obsoleteSecretIds: string[] = [];
    const remote = config as { url: string; headers?: unknown };
    const url = validateMcpRemoteUrl(remote.url);
    const previousHeaders = getPreviousStoredMap(previousConfig);
    const headerDrafts = inputMapToDrafts(
      remote.headers as McpStoredValueMap | Record<string, string> | undefined,
      'header',
    );
    const staged = stageMcpValueSecrets(
      secretStorage,
      serverName,
      'header',
      headerDrafts,
      previousHeaders,
    );
    obsoleteSecretIds.push(...staged.obsoleteSecretIds);
    const headers = Object.keys(staged.stored).length > 0 ? staged.stored : undefined;
    return {
      config: { type: 'http', url, ...(headers ? { headers } : {}) },
      obsoleteSecretIds,
    };
  }

  private async migrateLoadedServers(
    servers: ManagedMcpServer[],
    upgradedLegacySse: boolean,
  ): Promise<ManagedMcpServer[]> {
    await this.hydrateBearerAndOAuthSecrets(servers);

    const needsRewrite = servers.some((server) => needsStructuredMigration(server.config));
    if (!needsRewrite || !isSecretStorageAvailable(this.secretStorage)) {
      // Persist the SSE → HTTP rewrite so the migration notice appears once.
      if (upgradedLegacySse) {
        await this.saveInternal(servers);
        await this.hydrateBearerAndOAuthSecrets(servers);
      }
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

  private findStoredSecret(
    serverName: string,
    kind: McpSecretKind,
  ): { secretId: string; value: string } | undefined {
    if (!isSecretStorageAvailable(this.secretStorage)) {
      return undefined;
    }
    for (const secretId of listMcpSecretIds(serverName, kind)) {
      const value = this.secretStorage.getSecret(secretId);
      if (typeof value === 'string' && value.length > 0) {
        return { secretId, value };
      }
    }
    return undefined;
  }

  private getStoredSecret(
    serverName: string,
    kind: McpSecretKind,
  ): string | undefined {
    return this.findStoredSecret(serverName, kind)?.value;
  }

  /** Move a legacy-format secret onto the canonical id; no-op when current. */
  private migrateStoredSecretId(
    serverName: string,
    kind: McpSecretKind,
    found: { secretId: string; value: string } | undefined,
  ): void {
    if (!found || !isSecretStorageAvailable(this.secretStorage)) {
      return;
    }
    const canonical = getMcpSecretId(serverName, kind);
    if (found.secretId === canonical) {
      return;
    }
    this.secretStorage.setSecret(canonical, found.value);
    clearSyncSecret(this.secretStorage, found.secretId);
  }

  private setStoredSecret(
    serverName: string,
    kind: McpSecretKind,
    value: string,
  ): void {
    const secretStorage = this.transactionSecretStorage ?? this.secretStorage;
    if (!isSecretStorageAvailable(secretStorage)) {
      throw new Error('MCP secrets require Obsidian keychain storage.');
    }
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      this.clearStoredSecret(serverName, kind);
      return;
    }
    secretStorage.setSecret(getMcpSecretId(serverName, kind), trimmed);
  }

  private clearStoredSecret(serverName: string, kind: McpSecretKind): void {
    if (!isSecretStorageAvailable(this.secretStorage)) {
      return;
    }
    for (const secretId of listMcpSecretIds(serverName, kind)) {
      clearSyncSecret(this.secretStorage, secretId);
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
    const bearerToken = server.bearerToken?.trim();
    if (server.auth === 'bearer' && bearerToken) {
      this.setStoredSecret(server.name, 'bearer-token', bearerToken);
    } else {
      obsoleteSecretIds.push(...listMcpSecretIds(server.name, 'bearer-token'));
    }

    const clientSecret = server.oauth && typeof server.oauth === 'object'
      ? server.oauth.clientSecret?.trim()
      : undefined;
    if (clientSecret) {
      this.setStoredSecret(server.name, 'client-secret', clientSecret);
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
      this.migrateStoredSecretId(
        server.name,
        'bearer-token',
        this.findStoredSecret(server.name, 'bearer-token'),
      );
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
        this.migrateStoredSecretId(
          server.name,
          'client-secret',
          this.findStoredSecret(server.name, 'client-secret'),
        );
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

  private parseServers(file: ManagedMcpConfigFile, legacySseServers?: string[]): ManagedMcpServer[] {
    if (!file.mcpServers || typeof file.mcpServers !== 'object') {
      return [];
    }

    const piviMeta = file._pivi?.servers ?? {};
    const servers: ManagedMcpServer[] = [];

    for (const [name, rawConfig] of Object.entries(file.mcpServers)) {
      const persisted = isValidMcpServerName(name) ? readPersistedServerConfig(rawConfig) : null;
      if (!persisted) {
        continue;
      }
      const { config, legacySse } = persisted;
      if (legacySse) {
        legacySseServers?.push(name);
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
        // The old SSE endpoint rarely serves Streamable HTTP, so keep it off until the user updates it.
        enabled: legacySse ? false : meta.enabled ?? DEFAULT_MCP_SERVER.enabled,
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

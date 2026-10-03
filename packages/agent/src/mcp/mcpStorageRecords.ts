/** Persisted-record helpers for MCP storage: secret identifiers, Pivi server metadata, and stored-config readers. */

import {
  encodeUtf8Hex,
  isObsidianSecretId,
  resolveObsidianSecretId,
  stableProviderIdDigest,
} from '../auth/providerSecretStorage';
import { type ParseDiagnostic } from '../config/publication';
import type { SyncSecretStore } from '../ports';
import { validateMcpRemoteUrl } from './mcpValidation';
import {
  isLegacyPlainStringMap,
  type McpStoredValueMap,
  normalizeMcpStoredValueMap,
} from './mcpValueSources';
import type {
  ManagedMcpServer,
  McpServerConfig,
  StoredMcpOAuthConfig,
} from './types';
import {
  DEFAULT_MCP_SERVER,
  isMcpLegacySseServerConfig,
  isValidMcpServerConfig,
  upgradeLegacySseServerConfig,
} from './types';

export type McpSecretKind = 'bearer-token' | 'client-secret';

/** Accept a persisted config, upgrading legacy SSE entries to Streamable HTTP. */
export function readPersistedServerConfig(
  config: unknown,
): { config: McpServerConfig; legacySse: boolean } | null {
  if (isMcpLegacySseServerConfig(config)) {
    return { config: upgradeLegacySseServerConfig(config), legacySse: true };
  }
  return isValidMcpServerConfig(config) ? { config, legacySse: false } : null;
}

export interface PiviServerMeta {
  enabled?: boolean;
  contextSaving?: boolean;
  disabledTools?: string[];
  description?: string;
  auth?: ManagedMcpServer['auth'];
  oauth?: StoredMcpOAuthConfig | false;
  bearerTokenEnv?: string;
}

/** Pivi-owned server metadata persisted beside the MCP config; defaults are omitted. */
export function buildPiviServerMeta(server: ManagedMcpServer): PiviServerMeta {
  const meta: PiviServerMeta = {};
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
  return meta;
}

export class McpStorageStateChangedError extends Error {
  constructor() {
    super('MCP configuration changed before publication.');
    this.name = 'McpStorageStateChangedError';
  }
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

export function isSecretStorageAvailable(
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
  return `pivi-mcp-name-${serverName}-${kind}`;
}

function legacyEncodedMcpSecretId(serverName: string, kind: McpSecretKind): string {
  return `pivi-mcp-${encodeSecretName(serverName)}-${kind}`;
}

function digestMcpSecretId(serverName: string, kind: McpSecretKind): string {
  return `pivi-mcp-d-${stableProviderIdDigest(serverName)}-${kind}`;
}

/**
 * Canonical first, then the legacy hex-encoded name, then the digest fallback.
 * The explicit `name` segment prevents a plain server name from colliding with
 * another server's legacy hex encoding.
 */
export function listMcpSecretIds(serverName: string, kind: McpSecretKind): readonly string[] {
  const plain = directMcpSecretId(serverName, kind);
  const digest = digestMcpSecretId(serverName, kind);
  const canonical = resolveObsidianSecretId(plain, digest);
  return [...new Set([
    canonical,
    ...(isObsidianSecretId(plain) ? [plain] : []),
    legacyEncodedMcpSecretId(serverName, kind),
    digest,
  ])];
}

/** Canonical direct/digested SecretStorage IDs owned by one MCP server field. */
export function listMcpServerSecretIds(
  serverName: string,
  kind: McpSecretKind,
): readonly string[] {
  return listMcpSecretIds(serverName, kind);
}

export function getMcpSecretId(serverName: string, kind: McpSecretKind): string {
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

export function getExistingServerNames(
  existing: Record<string, unknown> | null,
): string[] {
  const raw = existing?.mcpServers;
  if (!raw || typeof raw !== 'object') {
    return [];
  }
  return Object.keys(raw);
}

export function getPreviousStoredMap(
  previous: McpServerConfig | undefined,
): McpStoredValueMap | undefined {
  if (!previous) {
    return undefined;
  }
  return normalizeMcpStoredValueMap((previous as { headers?: unknown }).headers);
}

export function needsStructuredMigration(config: McpServerConfig): boolean {
  const headers = (config as { headers?: unknown }).headers;
  return headers !== undefined && isLegacyPlainStringMap(headers);
}

export function normalizeManagedServerConfig(config: McpServerConfig): McpServerConfig {
  const remote = config as { url: string; headers?: unknown };
  const url = validateMcpRemoteUrl(remote.url);
  const headers = normalizeMcpStoredValueMap(remote.headers);
  return { type: 'http', url, ...(headers ? { headers } : {}) };
}

/**
 * Wraps secret storage so staged writes can be undone if publication fails.
 * Returns null when the host has no usable secret storage.
 */
export function createMcpSecretTransaction(underlying: SyncSecretStore | undefined): {
  storage: SyncSecretStore;
  rollback(): Array<{ target: string; message: string }>;
} | null {
  if (!isSecretStorageAvailable(underlying)) return null;
  const undo = new Map<string, { previous: string | null | undefined; staged: string }>();
  const storage: SyncSecretStore = {
    getSecret: id => underlying.getSecret(id),
    listSecrets: prefix => underlying.listSecrets(prefix),
    setSecret: (id, value) => {
      if (!undo.has(id)) undo.set(id, { previous: underlying.getSecret(id), staged: value });
      else undo.get(id)!.staged = value;
      underlying.setSecret(id, value);
    },
    ...(underlying.deleteSecret ? { deleteSecret: id => underlying.deleteSecret!(id) } : {}),
  };
  return {
    storage,
    rollback: () => {
      const failures: Array<{ target: string; message: string }> = [];
      for (const [id, entry] of undo) {
        try {
          // A concurrent OAuth writer wins over this transaction's undo.
          if (underlying.getSecret(id) !== entry.staged) continue;
          if (entry.previous == null && underlying.deleteSecret) underlying.deleteSecret(id);
          else underlying.setSecret(id, entry.previous ?? '');
        } catch (cause) {
          failures.push({
            target: id,
            message: cause instanceof Error ? cause.message : 'Secret rollback failed',
          });
        }
      }
      return failures;
    },
  };
}

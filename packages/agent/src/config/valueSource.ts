/**
 * Shared typed value sources for device-local environment entries and MCP
 * header/env fields. Secret values live only in SecretStorage; plain values may
 * persist in device-local or synced portable config; systemEnvironment values
 * are never copied into any Pivi store.
 */

import {
  encodeUtf8Hex,
  listObsidianSecretIds,
  stableProviderIdDigest,
} from '../auth/providerSecretStorage';
import type { SyncSecretStore } from '../ports';

export type ConfigValueSourceKind = 'plain' | 'secret' | 'systemEnvironment';

/** Persisted / local reference without embedding secret material. */
export type ConfigValueRef =
  | { kind: 'plain'; value: string }
  | { kind: 'secret' }
  | { kind: 'systemEnvironment'; name?: string };

/** Runtime draft that may carry a newly entered secret before staging. */
export type ConfigValueDraft =
  | { kind: 'plain'; value: string }
  | { kind: 'secret'; value?: string }
  | { kind: 'systemEnvironment'; name?: string };

const SECRET_LIKE_SUFFIXES = ['_API_KEY', '_TOKEN', '_SECRET', '_PASSWORD'] as const;

const SECRET_LIKE_EXACT_KEYS = new Set([
  'AUTHORIZATION',
  'PROXY-AUTHORIZATION',
  'PROXY_AUTHORIZATION',
  'COOKIE',
]);

const SECRET_LIKE_HEADER_PATTERNS: RegExp[] = [
  /^X-?API[-_]?KEY$/i,
  /API[-_]?KEY$/i,
];

function normalizeKey(key: string): string {
  return key.trim().toUpperCase();
}

/** True when a key must default to a secret or canonical credential source. */
export function isSecretLikeKey(key: string): boolean {
  const normalized = normalizeKey(key);
  if (!normalized) {
    return false;
  }
  if (SECRET_LIKE_EXACT_KEYS.has(normalized)) {
    return true;
  }
  if (SECRET_LIKE_SUFFIXES.some((suffix) => normalized.endsWith(suffix))) {
    return true;
  }
  return SECRET_LIKE_HEADER_PATTERNS.some((pattern) => pattern.test(normalized));
}

/** Header-name classification used by MCP remote header migration. */
export function isSecretLikeHeaderName(name: string): boolean {
  return isSecretLikeKey(name);
}

export function isConfigValueRef(value: unknown): value is ConfigValueRef {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  if (record.kind === 'plain') {
    return typeof record.value === 'string';
  }
  if (record.kind === 'secret') {
    return true;
  }
  if (record.kind === 'systemEnvironment') {
    return record.name === undefined || typeof record.name === 'string';
  }
  return false;
}

export function normalizeConfigValueRef(value: unknown): ConfigValueRef | null {
  if (typeof value === 'string') {
    return { kind: 'plain', value };
  }
  if (!isConfigValueRef(value)) {
    return null;
  }
  if (value.kind === 'plain') {
    return { kind: 'plain', value: value.value };
  }
  if (value.kind === 'secret') {
    return { kind: 'secret' };
  }
  const name = typeof value.name === 'string' ? value.name.trim() : undefined;
  return name ? { kind: 'systemEnvironment', name } : { kind: 'systemEnvironment' };
}

export function configValueRefEquals(a: ConfigValueRef, b: ConfigValueRef): boolean {
  if (a.kind !== b.kind) {
    return false;
  }
  if (a.kind === 'plain' && b.kind === 'plain') {
    return a.value === b.value;
  }
  if (a.kind === 'systemEnvironment' && b.kind === 'systemEnvironment') {
    return (a.name ?? '') === (b.name ?? '');
  }
  return true;
}

export interface ResolveConfigValueHost {
  getSecret(secretId: string): string | null | undefined;
  getSystemEnvironmentVariable(name: string): string | undefined;
}

export function resolveConfigValue(
  ref: ConfigValueRef,
  secretId: string,
  host: ResolveConfigValueHost,
  fallbackKey?: string,
): string | undefined {
  if (ref.kind === 'plain') {
    return ref.value;
  }
  if (ref.kind === 'secret') {
    const value = host.getSecret(secretId);
    return typeof value === 'string' && value.length > 0 ? value : undefined;
  }
  const name = (ref.name ?? fallbackKey ?? '').trim();
  if (!name) {
    return undefined;
  }
  return host.getSystemEnvironmentVariable(name);
}

const ENV_SECRET_PREFIX = 'pivi-env';
const ENV_SECRET_DIGEST_PREFIX = 'pivi-env-d';
const MCP_VALUE_SECRET_PREFIX = 'pivi-mcp-v';
const MCP_VALUE_SECRET_DIGEST_PREFIX = 'pivi-mcp-vd';

function listScopedSecretIds(
  directId: string,
  digestId: string,
): readonly string[] {
  return listObsidianSecretIds(directId, digestId);
}

export function getEnvironmentSecretId(scope: string, key: string): string {
  const encoded = encodeUtf8Hex(`${scope}\0${key}`);
  const direct = `${ENV_SECRET_PREFIX}-${encoded}`;
  const digest = `${ENV_SECRET_DIGEST_PREFIX}-${stableProviderIdDigest(`${scope}:${key}`)}`;
  return listScopedSecretIds(direct, digest)[0]!;
}

export function listEnvironmentSecretIds(scope: string, key: string): readonly string[] {
  const encoded = encodeUtf8Hex(`${scope}\0${key}`);
  const direct = `${ENV_SECRET_PREFIX}-${encoded}`;
  const digest = `${ENV_SECRET_DIGEST_PREFIX}-${stableProviderIdDigest(`${scope}:${key}`)}`;
  return listScopedSecretIds(direct, digest);
}

export function getMcpValueSecretId(
  serverName: string,
  channel: 'header' | 'env',
  key: string,
): string {
  const encoded = encodeUtf8Hex(`${serverName}\0${channel}\0${key}`);
  const direct = `${MCP_VALUE_SECRET_PREFIX}-${encoded}`;
  const digest = `${MCP_VALUE_SECRET_DIGEST_PREFIX}-${stableProviderIdDigest(`${serverName}:${channel}:${key}`)}`;
  return listScopedSecretIds(direct, digest)[0]!;
}

export function listMcpValueSecretIds(
  serverName: string,
  channel: 'header' | 'env',
  key: string,
): readonly string[] {
  const encoded = encodeUtf8Hex(`${serverName}\0${channel}\0${key}`);
  const direct = `${MCP_VALUE_SECRET_PREFIX}-${encoded}`;
  const digest = `${MCP_VALUE_SECRET_DIGEST_PREFIX}-${stableProviderIdDigest(`${serverName}:${channel}:${key}`)}`;
  return listScopedSecretIds(direct, digest);
}

export function readSecretAcrossIds(
  secretStorage: SyncSecretStore,
  secretIds: readonly string[],
): string | undefined {
  for (const secretId of secretIds) {
    const value = secretStorage.getSecret(secretId);
    if (typeof value === 'string' && value.length > 0) {
      return value;
    }
  }
  return undefined;
}

export function writeSecretAcrossIds(
  secretStorage: SyncSecretStore,
  secretIds: readonly string[],
  value: string,
): void {
  const trimmed = value.trim();
  const canonical = secretIds[0];
  if (!canonical) {
    throw new Error('Missing secret id.');
  }
  if (!trimmed) {
    clearSecretAcrossIds(secretStorage, secretIds);
    return;
  }
  secretStorage.setSecret(canonical, trimmed);
  for (const legacyId of secretIds.slice(1)) {
    secretStorage.setSecret(legacyId, '');
  }
}

export function clearSecretAcrossIds(
  secretStorage: SyncSecretStore,
  secretIds: readonly string[],
): void {
  for (const secretId of secretIds) {
    if (secretStorage.deleteSecret) {
      secretStorage.deleteSecret(secretId);
    } else {
      secretStorage.setSecret(secretId, '');
    }
  }
}

/**
 * Choose the default source kind for a newly imported plaintext value.
 * Secret-like keys require secret unless the caller explicitly overrides.
 */
export function defaultSourceKindForKey(key: string): ConfigValueSourceKind {
  return isSecretLikeKey(key) ? 'secret' : 'plain';
}

/** Reject unresolved secret-like plaintext unless the user chose an allowed source. */
export function assertAllowedSourceForKey(
  key: string,
  source: ConfigValueDraft,
): void {
  if (!isSecretLikeKey(key)) {
    return;
  }
  if (source.kind === 'plain') {
    throw new Error(
      `Secret-like key "${key}" cannot be saved as plaintext. Use secure storage or a system environment reference.`,
    );
  }
}

/**
 * Structured MCP header/env value references stored in `.pivi/mcp.json`.
 * Secret material is referenced only; values live in SecretStorage.
 */

import {
  clearSecretAcrossIds,
  type ConfigValueDraft,
  type ConfigValueRef,
  getMcpValueSecretId,
  isSecretLikeHeaderName,
  isSecretLikeKey,
  listMcpValueSecretIds,
  normalizeConfigValueRef,
  readSecretAcrossIds,
  resolveConfigValue,
  type ResolveConfigValueHost,
  writeSecretAcrossIds,
} from '../foundation/configValueSource';
import type { SyncSecretStore } from '../ports';

export { getMcpValueSecretId };

export type McpValueChannel = 'header' | 'env';

export type McpStoredValueMap = Record<string, ConfigValueRef>;

export function isLegacyPlainStringMap(value: unknown): value is Record<string, string> {
  return !!value
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.values(value as Record<string, unknown>).every((item) => typeof item === 'string');
}

export function isMcpStoredValueMap(value: unknown): value is McpStoredValueMap {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  return Object.values(value as Record<string, unknown>).every((item) => normalizeConfigValueRef(item) !== null);
}

export function normalizeMcpStoredValueMap(raw: unknown): McpStoredValueMap | undefined {
  if (raw === undefined) {
    return undefined;
  }
  if (isLegacyPlainStringMap(raw)) {
    const migrated: McpStoredValueMap = {};
    for (const [key, value] of Object.entries(raw)) {
      migrated[key] = { kind: 'plain', value };
    }
    return Object.keys(migrated).length > 0 ? migrated : undefined;
  }
  if (!isMcpStoredValueMap(raw)) {
    return undefined;
  }
  const next: McpStoredValueMap = {};
  for (const [key, value] of Object.entries(raw)) {
    const normalized = normalizeConfigValueRef(value);
    if (!normalized) {
      continue;
    }
    next[key] = normalized;
  }
  return Object.keys(next).length > 0 ? next : undefined;
}

/** Classify a legacy plaintext MCP value into a draft source. */
export function draftFromLegacyMcpPlaintext(
  key: string,
  value: string,
  channel: McpValueChannel,
): ConfigValueDraft {
  const secretLike = channel === 'header' ? isSecretLikeHeaderName(key) : isSecretLikeKey(key);
  if (secretLike) {
    return { kind: 'secret', value };
  }
  return { kind: 'plain', value };
}

export function migrateLegacyPlainMapToDrafts(
  map: Record<string, string> | undefined,
  channel: McpValueChannel,
): Record<string, ConfigValueDraft> {
  const drafts: Record<string, ConfigValueDraft> = {};
  if (!map) {
    return drafts;
  }
  for (const [key, value] of Object.entries(map)) {
    drafts[key] = draftFromLegacyMcpPlaintext(key, value, channel);
  }
  return drafts;
}

export function toStoredMcpValueMap(
  drafts: Record<string, ConfigValueDraft>,
): McpStoredValueMap {
  const stored: McpStoredValueMap = {};
  for (const [key, draft] of Object.entries(drafts)) {
    const trimmedKey = key.trim();
    if (!trimmedKey) {
      continue;
    }
    if (draft.kind === 'plain') {
      if (isSecretLikeKey(trimmedKey) || isSecretLikeHeaderName(trimmedKey)) {
        throw new Error(
          `Secret-like MCP value "${trimmedKey}" cannot be saved as plaintext.`,
        );
      }
      stored[trimmedKey] = { kind: 'plain', value: draft.value };
      continue;
    }
    if (draft.kind === 'secret') {
      stored[trimmedKey] = { kind: 'secret' };
      continue;
    }
    const name = draft.name?.trim();
    stored[trimmedKey] = name
      ? { kind: 'systemEnvironment', name }
      : { kind: 'systemEnvironment' };
  }
  return stored;
}

export function stageMcpValueSecrets(
  secretStorage: SyncSecretStore,
  serverName: string,
  channel: McpValueChannel,
  drafts: Record<string, ConfigValueDraft>,
  previous: McpStoredValueMap | undefined,
): {
  stored: McpStoredValueMap;
  stagedSecretIds: string[];
  obsoleteSecretIds: string[];
} {
  const stored = toStoredMcpValueMap(drafts);
  const stagedSecretIds: string[] = [];
  const nextSecretKeys = new Set<string>();

  for (const [key, draft] of Object.entries(drafts)) {
    if (draft.kind !== 'secret') {
      continue;
    }
    const trimmedKey = key.trim();
    nextSecretKeys.add(trimmedKey);
    const secretIds = listMcpValueSecretIds(serverName, channel, trimmedKey);
    if (typeof draft.value === 'string' && draft.value.length > 0) {
      writeSecretAcrossIds(secretStorage, secretIds, draft.value);
      stagedSecretIds.push(secretIds[0]!);
    } else {
      const existing = readSecretAcrossIds(secretStorage, secretIds);
      if (!existing) {
        throw new Error(`MCP ${channel} "${trimmedKey}" requires a secure storage value.`);
      }
    }
  }

  const obsoleteSecretIds: string[] = [];
  for (const [key, ref] of Object.entries(previous ?? {})) {
    if (ref.kind !== 'secret' || nextSecretKeys.has(key)) {
      continue;
    }
    obsoleteSecretIds.push(...listMcpValueSecretIds(serverName, channel, key));
  }

  return { stored, stagedSecretIds, obsoleteSecretIds };
}

export function resolveMcpValueMap(
  serverName: string,
  channel: McpValueChannel,
  map: McpStoredValueMap | undefined,
  host: ResolveConfigValueHost,
  secretStorage?: SyncSecretStore,
): Record<string, string> {
  const resolved: Record<string, string> = {};
  if (!map) {
    return resolved;
  }
  for (const [key, ref] of Object.entries(map)) {
    if (ref.kind === 'secret') {
      if (secretStorage) {
        const value = readSecretAcrossIds(
          secretStorage,
          listMcpValueSecretIds(serverName, channel, key),
        );
        if (typeof value === 'string') {
          resolved[key] = value;
        }
      }
      continue;
    }
    const secretId = getMcpValueSecretId(serverName, channel, key);
    const value = resolveConfigValue(ref, secretId, host, key);
    if (typeof value === 'string') {
      resolved[key] = value;
    }
  }
  return resolved;
}

export function clearMcpValueSecrets(
  secretStorage: SyncSecretStore,
  serverName: string,
  channel: McpValueChannel,
  map: McpStoredValueMap | undefined,
): void {
  for (const [key, ref] of Object.entries(map ?? {})) {
    if (ref.kind !== 'secret') {
      continue;
    }
    clearSecretAcrossIds(secretStorage, listMcpValueSecretIds(serverName, channel, key));
  }
}

export function storedMapToDrafts(
  map: McpStoredValueMap | undefined,
): Record<string, ConfigValueDraft> {
  const drafts: Record<string, ConfigValueDraft> = {};
  for (const [key, ref] of Object.entries(map ?? {})) {
    if (ref.kind === 'plain') {
      drafts[key] = { kind: 'plain', value: ref.value };
      continue;
    }
    if (ref.kind === 'secret') {
      drafts[key] = { kind: 'secret' };
      continue;
    }
    drafts[key] = ref.name
      ? { kind: 'systemEnvironment', name: ref.name }
      : { kind: 'systemEnvironment' };
  }
  return drafts;
}

export function inputMapToDrafts(
  map: McpStoredValueMap | Record<string, string> | undefined,
  channel: McpValueChannel,
): Record<string, ConfigValueDraft> {
  if (!map) {
    return {};
  }
  if (isLegacyPlainStringMap(map)) {
    return migrateLegacyPlainMapToDrafts(map, channel);
  }
  return storedMapToDrafts(map);
}

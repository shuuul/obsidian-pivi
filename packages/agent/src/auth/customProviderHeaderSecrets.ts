import type { CustomProviderConfig } from '../foundation/customProviders';
import type { SyncSecretStore } from '../ports';
import {
  encodeUtf8Hex,
  listObsidianSecretIds,
  stableProviderIdDigest,
} from './providerSecretStorage';

export const CUSTOM_PROVIDER_HEADER_SECRET_VERSION = 1 as const;

export interface CustomProviderHeaderSecretPayloadV1 {
  version: typeof CUSTOM_PROVIDER_HEADER_SECRET_VERSION;
  headers: Record<string, string>;
}

const HEADER_SECRET_PREFIX = 'pivi-custom-provider-headers';
const HEADER_SECRET_DIGEST_PREFIX = 'pivi-cph';

function encodeProviderId(providerId: string): string {
  return encodeUtf8Hex(providerId);
}

function legacyCustomProviderHeaderSecretId(providerId: string): string {
  return `${HEADER_SECRET_PREFIX}-${encodeProviderId(providerId)}-v${CUSTOM_PROVIDER_HEADER_SECRET_VERSION}`;
}

function digestCustomProviderHeaderSecretId(providerId: string): string {
  return `${HEADER_SECRET_DIGEST_PREFIX}-${stableProviderIdDigest(providerId)}-v${CUSTOM_PROVIDER_HEADER_SECRET_VERSION}`;
}

function listCustomProviderHeaderSecretIds(providerId: string): readonly string[] {
  return listObsidianSecretIds(
    legacyCustomProviderHeaderSecretId(providerId),
    digestCustomProviderHeaderSecretId(providerId),
  );
}

export function getCustomProviderHeaderSecretId(providerId: string): string {
  const ids = listCustomProviderHeaderSecretIds(providerId);
  return ids[0]!;
}

function readCustomProviderHeaderSecretRaw(
  secretStorage: SyncSecretStore,
  providerId: string,
): string | null {
  for (const secretId of listCustomProviderHeaderSecretIds(providerId)) {
    const raw = secretStorage.getSecret(secretId);
    if (raw) {
      return raw;
    }
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function normalizeHeaderMap(raw: unknown): Record<string, string> {
  if (!isRecord(raw)) {
    return {};
  }
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(raw)) {
    if (typeof name !== 'string' || typeof value !== 'string') {
      continue;
    }
    const trimmedName = name.trim();
    const trimmedValue = value.trim();
    if (!trimmedName || !trimmedValue) {
      continue;
    }
    headers[trimmedName] = trimmedValue;
  }
  return headers;
}

export function serializeCustomProviderHeaderSecret(
  headers: Record<string, string>,
): string {
  const payload: CustomProviderHeaderSecretPayloadV1 = {
    version: CUSTOM_PROVIDER_HEADER_SECRET_VERSION,
    headers: normalizeHeaderMap(headers),
  };
  return JSON.stringify(payload);
}

export function parseCustomProviderHeaderSecret(
  raw: string | null | undefined,
): Record<string, string> | null {
  if (!raw?.trim()) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed) || parsed.version !== CUSTOM_PROVIDER_HEADER_SECRET_VERSION) {
      return null;
    }
    const headers = normalizeHeaderMap(parsed.headers);
    return Object.keys(headers).length > 0 ? headers : null;
  } catch {
    return null;
  }
}

export function readCustomProviderHeaders(
  secretStorage: SyncSecretStore,
  providerId: string,
): Record<string, string> | null {
  return parseCustomProviderHeaderSecret(readCustomProviderHeaderSecretRaw(secretStorage, providerId));
}

export function writeCustomProviderHeaders(
  secretStorage: SyncSecretStore,
  providerId: string,
  headers: Record<string, string>,
): void {
  const normalized = normalizeHeaderMap(headers);
  const secretId = getCustomProviderHeaderSecretId(providerId);
  if (Object.keys(normalized).length === 0) {
    secretStorage.setSecret(secretId, '');
    return;
  }
  secretStorage.setSecret(secretId, serializeCustomProviderHeaderSecret(normalized));
}

export function deleteCustomProviderHeaders(
  secretStorage: SyncSecretStore,
  providerId: string,
): void {
  for (const secretId of listCustomProviderHeaderSecretIds(providerId)) {
    secretStorage.setSecret(secretId, '');
  }
}

/** Merge SecretStorage header payloads into runtime custom provider configs. */
export function mergeCustomProviderHeaderSecrets(
  secretStorage: SyncSecretStore,
  configs: readonly CustomProviderConfig[],
): CustomProviderConfig[] {
  return configs.map((config) => {
    const headers = readCustomProviderHeaders(secretStorage, config.id);
    if (!headers) {
      return config;
    }
    return { ...config, headers: { ...headers } };
  });
}

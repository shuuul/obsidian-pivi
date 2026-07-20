import type { SyncSecretStore } from '../ports';

export const PIVI_PROVIDER_SECRET_PREFIX = 'pivi';

/** Obsidian SecretStorage (keychain) requires app 1.11.4+. */
export const MIN_OBSIDIAN_VERSION_FOR_KEYCHAIN = '1.11.4';

/** Obsidian rejects secret IDs longer than 64 lowercase alphanumeric/dash characters. */
export const MAX_OBSIDIAN_SECRET_ID_LENGTH = 64;

const OBSIDIAN_SECRET_ID_PATTERN = /^[a-z0-9-]+$/;

export function isObsidianSecretId(secretId: string): boolean {
  return secretId.length > 0
    && secretId.length <= MAX_OBSIDIAN_SECRET_ID_LENGTH
    && OBSIDIAN_SECRET_ID_PATTERN.test(secretId);
}

/** Max provider id length for `pivi-{providerId}-credential` secret keys. */
export function getMaxProviderIdLengthForPiCredentialSecret(): number {
  return MAX_OBSIDIAN_SECRET_ID_LENGTH
    - `${PIVI_PROVIDER_SECRET_PREFIX}-`.length
    - '-credential'.length;
}

/** Stable lowercase hex digest for provider-scoped secret keys that cannot embed the raw id. */
export function stableProviderIdDigest(providerId: string): string {
  let hash = 0xcbf29ce484222325n;
  for (const byte of new TextEncoder().encode(providerId)) {
    hash ^= BigInt(byte);
    hash = (hash * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return hash.toString(16).padStart(16, '0');
}

export function encodeUtf8Hex(value: string): string {
  return Array.from(new TextEncoder().encode(value))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export function resolveObsidianSecretId(directId: string, digestId: string): string {
  if (isObsidianSecretId(directId)) {
    return directId;
  }
  if (!isObsidianSecretId(digestId)) {
    throw new Error('Digest secret ID still exceeds Obsidian keychain limits.');
  }
  return digestId;
}

export function listObsidianSecretIds(directId: string, digestId: string): readonly string[] {
  const canonical = resolveObsidianSecretId(directId, digestId);
  if (canonical === directId) {
    return [directId];
  }
  return [digestId, directId];
}

export type ProviderCredentialKind = 'api-key' | 'oauth-token';

export function isSecretStorageAvailable(
  secretStorage: SyncSecretStore | undefined,
): secretStorage is SyncSecretStore {
  return !!secretStorage
    && typeof secretStorage.getSecret === 'function'
    && typeof secretStorage.setSecret === 'function'
    && typeof secretStorage.listSecrets === 'function';
}

export function getProviderCredentialSecretId(
  providerId: string,
  kind: ProviderCredentialKind,
): string {
  return `${PIVI_PROVIDER_SECRET_PREFIX}-${providerId}-${kind}`;
}

export function parseProviderCredentialSecretId(
  secretId: string,
): { providerId: string; kind: ProviderCredentialKind } | null {
  const match = new RegExp(
    `^${PIVI_PROVIDER_SECRET_PREFIX}-(.+)-(api-key|oauth-token)$`,
  ).exec(secretId);
  if (!match) {
    return null;
  }
  const providerId = match[1];
  const kind = match[2];
  if (!providerId || (kind !== 'api-key' && kind !== 'oauth-token')) {
    return null;
  }
  return {
    providerId,
    kind,
  };
}

export function getProviderCredentialSecret(
  secretStorage: SyncSecretStore,
  providerId: string,
  kind: ProviderCredentialKind,
): string | null {
  const value = secretStorage.getSecret(getProviderCredentialSecretId(providerId, kind));
  if (typeof value === 'string' && value.length > 0) {
    return value;
  }
  return null;
}

export function isProviderDisabled(
  disabledProviders: readonly string[] | undefined,
  providerId: string,
): boolean {
  return disabledProviders?.includes(providerId) ?? false;
}

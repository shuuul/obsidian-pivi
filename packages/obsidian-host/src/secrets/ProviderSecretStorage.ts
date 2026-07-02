import type { SecretStorage } from 'obsidian';

export const PIVI_PROVIDER_SECRET_PREFIX = 'pivi';

/** Obsidian SecretStorage (keychain) requires app 1.11.4+. */
export const MIN_OBSIDIAN_VERSION_FOR_KEYCHAIN = '1.11.4';

export type ProviderCredentialKind = 'api-key' | 'oauth-token';

export function isSecretStorageAvailable(
  secretStorage: SecretStorage | undefined,
): secretStorage is SecretStorage {
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
  return {
    providerId: match[1],
    kind: match[2] as ProviderCredentialKind,
  };
}

export function getProviderCredentialSecret(
  secretStorage: SecretStorage,
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

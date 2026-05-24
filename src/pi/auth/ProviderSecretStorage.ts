import type { SecretStorage } from 'obsidian';

import { parseEnvironmentVariables } from '../../utils/env';
import { CODEX_OAUTH_PROVIDER_ID } from './ProviderOAuthService';
import { getProviderEnvVarNames, type ProviderEnvVarNames } from './providerEnvVars';

export const OBSIUS_PROVIDER_SECRET_PREFIX = 'obsius2';

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
  return `${OBSIUS_PROVIDER_SECRET_PREFIX}-${providerId}-${kind}`;
}

export function parseProviderCredentialSecretId(
  secretId: string,
): { providerId: string; kind: ProviderCredentialKind } | null {
  const match = new RegExp(
    `^${OBSIUS_PROVIDER_SECRET_PREFIX}-(.+)-(api-key|oauth-token)$`,
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

export function setProviderCredentialSecret(
  secretStorage: SecretStorage,
  providerId: string,
  kind: ProviderCredentialKind,
  secret: string,
): void {
  secretStorage.setSecret(
    getProviderCredentialSecretId(providerId, kind),
    secret.trim(),
  );
}

/** Provider ids that have a non-empty api-key or oauth-token secret in keychain. */
export function listProviderIdsWithKeychainSecrets(secretStorage: SecretStorage): string[] {
  const providerIds = new Set<string>();

  for (const secretId of secretStorage.listSecrets()) {
    const parsed = parseProviderCredentialSecretId(secretId);
    if (!parsed) {
      continue;
    }
    if (getProviderCredentialSecret(secretStorage, parsed.providerId, parsed.kind)) {
      providerIds.add(parsed.providerId);
    }
  }

  return [...providerIds].sort();
}

export function isProviderConfiguredInKeychain(
  secretStorage: SecretStorage,
  providerId: string,
  envVars: ProviderEnvVarNames = getProviderEnvVarNames(providerId),
): boolean {
  if (getProviderCredentialSecret(secretStorage, providerId, 'api-key')) {
    return true;
  }
  if (envVars.oauthVar && getProviderCredentialSecret(secretStorage, providerId, 'oauth-token')) {
    return true;
  }
  return false;
}

export function isProviderDisabled(
  disabledProviders: readonly string[] | undefined,
  providerId: string,
): boolean {
  return disabledProviders?.includes(providerId) ?? false;
}

export function isProviderConfigured(
  secretStorage: SecretStorage,
  providerId: string,
  environmentVariables: string,
  options: { codexConnected?: boolean; disabledProviders?: readonly string[] },
): boolean {
  if (isProviderDisabled(options.disabledProviders, providerId)) {
    return false;
  }
  if (providerId === CODEX_OAUTH_PROVIDER_ID) {
    return options.codexConnected ?? false;
  }

  if (isProviderConfiguredInKeychain(secretStorage, providerId)) {
    return true;
  }

  const env = parseEnvironmentVariables(environmentVariables);
  const names = getProviderEnvVarNames(providerId);
  if (env[names.apiKeyVar]?.trim()) {
    return true;
  }
  if (names.oauthVar && env[names.oauthVar]?.trim()) {
    return true;
  }
  return false;
}

/**
 * Moves plaintext credential values from the env string into Obsidian keychain.
 * Returns the updated env text with credential keys removed.
 */
export function migratePlaintextProviderSecretsToKeychain(
  secretStorage: SecretStorage,
  providerId: string,
  environmentVariables: string,
  envVars: ProviderEnvVarNames = getProviderEnvVarNames(providerId),
): { environmentVariables: string; changed: boolean } {
  const env = parseEnvironmentVariables(environmentVariables);
  let changed = false;

  const apiPlain = env[envVars.apiKeyVar]?.trim();
  if (apiPlain) {
    setProviderCredentialSecret(secretStorage, providerId, 'api-key', apiPlain);
    delete env[envVars.apiKeyVar];
    changed = true;
  }

  if (envVars.oauthVar) {
    const oauthPlain = env[envVars.oauthVar]?.trim();
    if (oauthPlain) {
      setProviderCredentialSecret(secretStorage, providerId, 'oauth-token', oauthPlain);
      delete env[envVars.oauthVar];
      changed = true;
    }
  }

  if (!changed) {
    return { environmentVariables, changed: false };
  }

  const lines = Object.entries(env).map(([key, value]) => `${key}=${value}`);
  return {
    environmentVariables: lines.join('\n'),
    changed: true,
  };
}

export function migrateAllPlaintextProviderSecretsToKeychain(
  secretStorage: SecretStorage,
  providerIds: readonly string[],
  environmentVariables: string,
): { environmentVariables: string; changed: boolean } {
  let nextEnv = environmentVariables;
  let changed = false;

  for (const providerId of providerIds) {
    const result = migratePlaintextProviderSecretsToKeychain(
      secretStorage,
      providerId,
      nextEnv,
    );
    nextEnv = result.environmentVariables;
    changed = changed || result.changed;
  }

  return { environmentVariables: nextEnv, changed };
}

export function syncPiProvidersFromKeychain(
  secretStorage: SecretStorage,
  addedProviders: readonly string[],
  environmentVariables: string,
): {
  addedProviders: string[];
  environmentVariables: string;
  changed: boolean;
} {
  const discovered = listProviderIdsWithKeychainSecrets(secretStorage);
  const mergedProviders = [...new Set([...addedProviders, ...discovered])];
  const migration = migrateAllPlaintextProviderSecretsToKeychain(
    secretStorage,
    mergedProviders,
    environmentVariables,
  );

  const providersChanged = mergedProviders.length !== addedProviders.length;
  return {
    addedProviders: mergedProviders,
    environmentVariables: migration.environmentVariables,
    changed: providersChanged || migration.changed,
  };
}

export function resolveProviderCredentialFromKeychain(
  secretStorage: SecretStorage,
  providerId: string,
  envVars: ProviderEnvVarNames = getProviderEnvVarNames(providerId),
): string | undefined {
  const apiKey = getProviderCredentialSecret(secretStorage, providerId, 'api-key');
  if (apiKey) {
    return apiKey;
  }
  if (envVars.oauthVar) {
    const oauth = getProviderCredentialSecret(secretStorage, providerId, 'oauth-token');
    if (oauth) {
      return oauth;
    }
  }
  return undefined;
}

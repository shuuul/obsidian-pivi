import type {
  AuthContext,
  Credential,
  CredentialInfo,
  CredentialStore,
} from '@earendil-works/pi-ai';

import {
  ANTHROPIC_PROVIDER_ID,
  CLAUDE_PROVIDER_ID,
  credentialToApiKey,
  getPiAiCredentialSecretId,
  GROK_BUILD_PROVIDER_ID,
  isOAuthCredential,
  listPiAiCredentialSecretIds,
  parseProviderCredential,
  serializeProviderCredential,
  XAI_PROVIDER_ID,
} from '../../auth/piProviderCredentials';
import { isSupportedPiProviderId } from '../../auth/piProviderValidation';
import { getProviderEnvVarNames, type ProviderEnvVarNames } from '../../auth/providerEnvVars';
import {
  getProviderCredentialSecret,
  getProviderCredentialSecretId,
  isSecretStorageAvailable,
  PIVI_PROVIDER_SECRET_PREFIX,
  type ProviderCredentialKind,
} from '../../auth/providerSecretStorage';
import { getPiAgentSettings } from '../../foundation/agentSettings';
import { parseEnvironmentVariables } from '../../foundation/settingsEnv';
import type { AuthContextHost, SyncSecretStore } from '../../ports';
import type { PiRuntimeHost } from './piRuntimeHost';

const LEGACY_PI_AI_CREDENTIAL_KIND = 'credential-v2';
const OAUTH_NO_EXPIRY = Number.MAX_SAFE_INTEGER;

export { credentialToApiKey, getPiAiCredentialSecretId, isOAuthCredential };

function getLegacyPiAiCredentialSecretId(providerId: string): string {
  return `${PIVI_PROVIDER_SECRET_PREFIX}-${providerId}-${LEGACY_PI_AI_CREDENTIAL_KIND}`;
}

function readStoredProviderCredential(
  secretStorage: SyncSecretStore,
  providerId: string,
): Credential | undefined {
  for (const secretId of listPiAiCredentialSecretIds(providerId)) {
    const credential = parseProviderCredential(secretStorage.getSecret(secretId));
    if (credential) {
      return credential as Credential;
    }
  }
  return undefined;
}

function legacyCredentialForKind(
  secretStorage: SyncSecretStore,
  providerId: string,
  kind: ProviderCredentialKind,
): Credential | undefined {
  const secret = getProviderCredentialSecret(secretStorage, providerId, kind);
  if (!secret) {
    return undefined;
  }
  return kind === 'api-key'
    ? { type: 'api_key', key: secret }
    : { type: 'oauth', access: secret, refresh: '', expires: Number.MAX_SAFE_INTEGER };
}

function readLegacyCredential(secretStorage: SyncSecretStore, providerId: string): Credential | undefined {
  const envVars = getProviderEnvVarNames(providerId);
  if (envVars.oauthVar) {
    const oauth = legacyCredentialForKind(secretStorage, providerId, 'oauth-token');
    if (oauth) {
      return oauth;
    }
  }
  return legacyCredentialForKind(secretStorage, providerId, 'api-key');
}

function readLegacyPiAiCredential(secretStorage: SyncSecretStore, providerId: string): Credential | undefined {
  return parseProviderCredential(secretStorage.getSecret(getLegacyPiAiCredentialSecretId(providerId))) as Credential | undefined;
}

function credentialFromEnvironment(
  env: Record<string, string>,
  providerId: string,
  envVars: ProviderEnvVarNames = getProviderEnvVarNames(providerId),
): Credential | undefined {
  const oauth = envVars.oauthVar ? env[envVars.oauthVar]?.trim() : undefined;
  if (oauth) {
    return { type: 'oauth', access: oauth, refresh: '', expires: OAUTH_NO_EXPIRY };
  }

  const apiKey = env[envVars.apiKeyVar]?.trim();
  if (apiKey) {
    return { type: 'api_key', key: apiKey };
  }

  return undefined;
}

function removeCredentialEnvironmentValues(
  env: Record<string, string>,
  providerId: string,
  envVars: ProviderEnvVarNames = getProviderEnvVarNames(providerId),
): boolean {
  let changed = false;
  if (env[envVars.apiKeyVar] !== undefined) {
    delete env[envVars.apiKeyVar];
    changed = true;
  }
  if (envVars.oauthVar && env[envVars.oauthVar] !== undefined) {
    delete env[envVars.oauthVar];
    changed = true;
  }
  return changed;
}

function serializeEnvironmentVariables(env: Record<string, string>): string {
  return Object.entries(env).map(([key, value]) => `${key}=${value}`).join('\n');
}

function clearSecretIfPresent(secretStorage: SyncSecretStore, secretId: string): boolean {
  if (!secretStorage.getSecret(secretId)) {
    return false;
  }
  secretStorage.setSecret(secretId, '');
  return true;
}

function clearMigratedProviderSecrets(secretStorage: SyncSecretStore, providerId: string): boolean {
  let changed = clearSecretIfPresent(secretStorage, getLegacyPiAiCredentialSecretId(providerId));
  changed = clearSecretIfPresent(secretStorage, getProviderCredentialSecretId(providerId, 'api-key')) || changed;
  changed = clearSecretIfPresent(secretStorage, getProviderCredentialSecretId(providerId, 'oauth-token')) || changed;
  return changed;
}

function migrateProviderCredential(
  secretStorage: SyncSecretStore,
  providerId: string,
  env: Record<string, string>,
): { credentialsChanged: boolean; environmentChanged: boolean } {
  const envCredential = credentialFromEnvironment(env, providerId);
  if (envCredential) {
    secretStorage.setSecret(getPiAiCredentialSecretId(providerId), serializeProviderCredential(envCredential));
    const environmentChanged = removeCredentialEnvironmentValues(env, providerId);
    clearMigratedProviderSecrets(secretStorage, providerId);
    return { credentialsChanged: true, environmentChanged };
  }

  const current = readStoredProviderCredential(secretStorage, providerId);
  if (current) {
    return {
      credentialsChanged: clearMigratedProviderSecrets(secretStorage, providerId),
      environmentChanged: false,
    };
  }

  const legacy = readLegacyPiAiCredential(secretStorage, providerId)
    ?? readLegacyCredential(secretStorage, providerId);
  if (legacy) {
    secretStorage.setSecret(getPiAiCredentialSecretId(providerId), serializeProviderCredential(legacy));
    clearMigratedProviderSecrets(secretStorage, providerId);
    return { credentialsChanged: true, environmentChanged: false };
  }

  return {
    credentialsChanged: clearMigratedProviderSecrets(secretStorage, providerId),
    environmentChanged: false,
  };
}

export function migratePiProviderCredentialsToKeychain(
  secretStorage: SyncSecretStore,
  addedProviders: readonly string[],
  environmentVariables: string,
): {
  addedProviders: string[];
  environmentVariables: string;
  changed: boolean;
} {
  const env = parseEnvironmentVariables(environmentVariables);
  // Only migrate credentials for built-in providers. Preserve the exact
  // settings-owned membership and order, including custom/local ids.
  const builtinAddedProviders = addedProviders.filter(isSupportedPiProviderId);
  // Durable settings own provider membership. A credential key without a
  // matching settings entry must never recreate a deleted provider.
  const providerIds = [...new Set(builtinAddedProviders)];

  let credentialsChanged = false;
  let environmentChanged = false;
  for (const providerId of providerIds) {
    const result = migrateProviderCredential(secretStorage, providerId, env);
    credentialsChanged = credentialsChanged || result.credentialsChanged;
    environmentChanged = environmentChanged || result.environmentChanged;
  }

  return {
    addedProviders: [...new Set(addedProviders)],
    environmentVariables: environmentChanged
      ? serializeEnvironmentVariables(env)
      : environmentVariables,
    changed: credentialsChanged || environmentChanged,
  };
}

const SUBSCRIPTION_OAUTH_MIGRATION_PAIRS = [
  { piProviderId: XAI_PROVIDER_ID, subscriptionProviderId: GROK_BUILD_PROVIDER_ID },
  { piProviderId: ANTHROPIC_PROVIDER_ID, subscriptionProviderId: CLAUDE_PROVIDER_ID },
] as const;

/** Move legacy OAuth credentials off API-provider slots into plan-provider slots. */
export function migrateSplitSubscriptionOAuthCredentials(
  secretStorage: SyncSecretStore,
  addedProviders: readonly string[],
): { addedProviders: string[]; migratedPiProviderIds: string[]; changed: boolean } {
  let changed = false;
  let nextAdded = [...addedProviders];
  const migratedPiProviderIds: string[] = [];

  for (const { piProviderId, subscriptionProviderId } of SUBSCRIPTION_OAUTH_MIGRATION_PAIRS) {
    const mainCredential = readStoredProviderCredential(secretStorage, piProviderId);
    const existingSubscriptionCredential = readStoredProviderCredential(secretStorage, subscriptionProviderId);
    const hadLegacyOAuth = isOAuthCredential(mainCredential);
    if (hadLegacyOAuth) {
      if (!existingSubscriptionCredential) {
        secretStorage.setSecret(
          getPiAiCredentialSecretId(subscriptionProviderId),
          serializeProviderCredential(mainCredential),
        );
      }
      secretStorage.setSecret(getPiAiCredentialSecretId(piProviderId), '');
      changed = true;
    }

    const subscriptionCredential = readStoredProviderCredential(secretStorage, subscriptionProviderId);
    if (hadLegacyOAuth && isOAuthCredential(subscriptionCredential)) {
      migratedPiProviderIds.push(piProviderId);
    }
    // Expand membership only when the API-provider slot is still registered.
    // Orphan subscription OAuth must never resurrect a removed provider.
    if (
      isOAuthCredential(subscriptionCredential)
      && !nextAdded.includes(subscriptionProviderId)
      && nextAdded.includes(piProviderId)
    ) {
      nextAdded = [...nextAdded, subscriptionProviderId];
      changed = true;
    }
  }

  return { addedProviders: nextAdded, migratedPiProviderIds, changed };
}

export class ObsidianCredentialStore implements CredentialStore {
  private readonly chains = new Map<string, Promise<unknown>>();

  constructor(private readonly secretStorage: SyncSecretStore) {}

  readSync(providerId: string): Credential | undefined {
    return readStoredProviderCredential(this.secretStorage, providerId);
  }

  read(providerId: string): Promise<Credential | undefined> {
    return Promise.resolve(this.readSync(providerId));
  }

  async list(): Promise<readonly CredentialInfo[]> {
    const secretIds = this.secretStorage.listSecrets(`${PIVI_PROVIDER_SECRET_PREFIX}-`);
    const infos: CredentialInfo[] = [];
    for (const secretId of secretIds) {
      const match = new RegExp(`^${PIVI_PROVIDER_SECRET_PREFIX}-(.+)-credential$`).exec(secretId);
      if (!match?.[1]) {
        continue;
      }
      const providerId = match[1];
      const credential = parseProviderCredential(this.secretStorage.getSecret(secretId));
      if (!credential || (credential.type !== 'api_key' && credential.type !== 'oauth')) {
        continue;
      }
      infos.push({ providerId, type: credential.type });
    }
    return infos;
  }

  modify(
    providerId: string,
    fn: (current: Credential | undefined) => Promise<Credential | undefined>,
  ): Promise<Credential | undefined> {
    return this.enqueue(providerId, async () => {
      const current = this.readSync(providerId);
      const next = await fn(current);
      if (next !== undefined) {
        this.writeSync(providerId, next);
        return next;
      }
      return current;
    });
  }

  async delete(providerId: string): Promise<void> {
    await this.enqueue(providerId, () => {
      this.clearSync(providerId);
      return Promise.resolve();
    });
  }

  writeSync(providerId: string, credential: Credential): void {
    this.secretStorage.setSecret(getPiAiCredentialSecretId(providerId), serializeProviderCredential(credential));
  }

  clearSync(providerId: string): void {
    for (const secretId of listPiAiCredentialSecretIds(providerId)) {
      this.secretStorage.setSecret(secretId, '');
    }
  }

  private enqueue<T>(providerId: string, task: () => Promise<T>): Promise<T> {
    const previous = this.chains.get(providerId) ?? Promise.resolve();
    const next = (async () => {
      await previous.catch(() => undefined);
      return task();
    })();
    this.chains.set(providerId, next.catch(() => undefined));
    return next;
  }
}

export function createObsidianCredentialStore(
  secretStorage: SyncSecretStore | undefined,
): ObsidianCredentialStore | null {
  if (!isSecretStorageAvailable(secretStorage)) {
    return null;
  }
  return new ObsidianCredentialStore(secretStorage);
}

export type ObsidianAuthContextOptions = Partial<AuthContextHost>;

export class ObsidianAuthContext implements AuthContext {
  constructor(
    private readonly plugin: PiRuntimeHost,
    private readonly options: ObsidianAuthContextOptions = {},
  ) {}

  env(name: string): Promise<string | undefined> {
    const piSettings = getPiAgentSettings(this.plugin.settings);
    const piEnv = parseEnvironmentVariables(piSettings.environmentVariables);
    const sharedEnvironmentVariables = this.plugin.settings?.sharedEnvironmentVariables;
    const sharedEnv = parseEnvironmentVariables(
      typeof sharedEnvironmentVariables === 'string' ? sharedEnvironmentVariables : '',
    );
    const getExtVar = () => this.options.getEnvironmentVariable ? this.options.getEnvironmentVariable(name) : undefined;
    return Promise.resolve(piEnv[name] ?? sharedEnv[name] ?? getExtVar());
  }

  fileExists(path: string): Promise<boolean> {
    const getHomeDir = () => this.options.getHomeDirectory ? this.options.getHomeDirectory() : '';
    const expanded = path.startsWith('~/')
      ? `${getHomeDir()}${path.slice(1)}`
      : path;
    if (!expanded) {
      return Promise.resolve(false);
    }
    try {
      return Promise.resolve(this.options.fileExists ? this.options.fileExists(expanded) : false);
    } catch {
      return Promise.resolve(false);
    }
  }
}

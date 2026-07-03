import type {
  AuthContext,
  Credential,
  CredentialStore,
} from '@earendil-works/pi-ai';
import {
  credentialToApiKey,
  getPiAiCredentialSecretId,
  isOAuthCredential,
  parseProviderCredential,
  serializeProviderCredential,
} from '@pivi/pivi-agent-core/auth/PiProviderCredentials';
import { getProviderEnvVarNames, type ProviderEnvVarNames } from '@pivi/pivi-agent-core/auth/providerEnvVars';
import {
  getProviderCredentialSecret,
  getProviderCredentialSecretId,
  isSecretStorageAvailable,
  parseProviderCredentialSecretId,
  PIVI_PROVIDER_SECRET_PREFIX,
  type ProviderCredentialKind,
} from '@pivi/pivi-agent-core/auth/ProviderSecretStorage';
import type { PiRuntimeHost } from '@pivi/pivi-agent-core/engine/pi/PiRuntimeHost';
import { getPiAgentSettings } from '@pivi/pivi-agent-core/foundation/agentSettings';
import { parseEnvironmentVariables } from '@pivi/pivi-agent-core/foundation/settingsEnv';
import type { AuthContextHost, SyncSecretStore } from '@pivi/pivi-agent-core/ports';

const PI_AI_CREDENTIAL_KIND = 'credential';
const LEGACY_PI_AI_CREDENTIAL_KIND = 'credential-v2';
const OAUTH_NO_EXPIRY = Number.MAX_SAFE_INTEGER;

export { credentialToApiKey, getPiAiCredentialSecretId, isOAuthCredential };

function getLegacyPiAiCredentialSecretId(providerId: string): string {
  return `${PIVI_PROVIDER_SECRET_PREFIX}-${providerId}-${LEGACY_PI_AI_CREDENTIAL_KIND}`;
}

function parsePiAiCredentialSecretIdForKind(secretId: string, kind: string): string | null {
  const prefix = `${PIVI_PROVIDER_SECRET_PREFIX}-`;
  const suffix = `-${kind}`;
  if (!secretId.startsWith(prefix) || !secretId.endsWith(suffix)) {
    return null;
  }
  const providerId = secretId.slice(prefix.length, -suffix.length);
  return providerId || null;
}

function parsePiAiCredentialSecretId(secretId: string): string | null {
  return parsePiAiCredentialSecretIdForKind(secretId, PI_AI_CREDENTIAL_KIND);
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
    ? { type: 'api-key', key: secret }
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
    return { type: 'api-key', key: apiKey };
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
  if (secretStorage.getSecret(secretId) === null) {
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

function discoverProviderIdsWithCredentialSecrets(secretStorage: SyncSecretStore): string[] {
  const providerIds = new Set<string>();

  for (const secretId of secretStorage.listSecrets()) {
    if (secretStorage.getSecret(secretId) === null) {
      continue;
    }

    const canonicalProviderId = parsePiAiCredentialSecretIdForKind(secretId, PI_AI_CREDENTIAL_KIND);
    if (canonicalProviderId) {
      providerIds.add(canonicalProviderId);
      continue;
    }

    const legacyPiAiProviderId = parsePiAiCredentialSecretIdForKind(secretId, LEGACY_PI_AI_CREDENTIAL_KIND);
    if (legacyPiAiProviderId) {
      providerIds.add(legacyPiAiProviderId);
      continue;
    }

    const legacyProviderSecret = parseProviderCredentialSecretId(secretId);
    if (legacyProviderSecret) {
      providerIds.add(legacyProviderSecret.providerId);
    }
  }

  return [...providerIds].sort();
}

function listCanonicalProviderIdsWithCredentials(secretStorage: SyncSecretStore): string[] {
  const providerIds = new Set<string>();
  for (const secretId of secretStorage.listSecrets()) {
    const providerId = parsePiAiCredentialSecretId(secretId);
    if (providerId && parseProviderCredential(secretStorage.getSecret(secretId))) {
      providerIds.add(providerId);
    }
  }
  return [...providerIds].sort();
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

  const current = parseProviderCredential(secretStorage.getSecret(getPiAiCredentialSecretId(providerId)));
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
  const providerIds = [...new Set([
    ...addedProviders,
    ...discoverProviderIdsWithCredentialSecrets(secretStorage),
  ])];

  let credentialsChanged = false;
  let environmentChanged = false;
  for (const providerId of providerIds) {
    const result = migrateProviderCredential(secretStorage, providerId, env);
    credentialsChanged = credentialsChanged || result.credentialsChanged;
    environmentChanged = environmentChanged || result.environmentChanged;
  }

  const credentialProviders = listCanonicalProviderIdsWithCredentials(secretStorage);
  const mergedProviders = [...new Set([...addedProviders, ...credentialProviders])];
  const providersChanged = mergedProviders.length !== addedProviders.length;
  return {
    addedProviders: mergedProviders,
    environmentVariables: environmentChanged
      ? serializeEnvironmentVariables(env)
      : environmentVariables,
    changed: providersChanged || credentialsChanged || environmentChanged,
  };
}

export class ObsidianCredentialStore implements CredentialStore {
  private readonly chains = new Map<string, Promise<unknown>>();

  constructor(private readonly secretStorage: SyncSecretStore) {}

  readSync(providerId: string): Credential | undefined {
    return parseProviderCredential(
      this.secretStorage.getSecret(getPiAiCredentialSecretId(providerId)),
    ) as Credential | undefined;
  }

  read(providerId: string): Promise<Credential | undefined> {
    return Promise.resolve(this.readSync(providerId));
  }

  listProviderIdsSync(): string[] {
    const providerIds = new Set<string>();
    for (const secretId of this.secretStorage.listSecrets()) {
      const providerId = parsePiAiCredentialSecretId(secretId);
      if (providerId && this.readSync(providerId)) {
        providerIds.add(providerId);
      }
    }
    return [...providerIds].sort();
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
    clearMigratedProviderSecrets(this.secretStorage, providerId);
  }

  clearSync(providerId: string): void {
    this.secretStorage.setSecret(getPiAiCredentialSecretId(providerId), '');
    clearMigratedProviderSecrets(this.secretStorage, providerId);
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

const defaultAuthContextOptions: AuthContextHost = {
  getEnvironmentVariable: () => undefined,
  fileExists: () => false,
  getHomeDirectory: () => '',
};

export class ObsidianAuthContext implements AuthContext {
  constructor(
    private readonly plugin: PiRuntimeHost,
    private readonly options: ObsidianAuthContextOptions = {},
  ) {}

  env(name: string): Promise<string | undefined> {
    const piSettings = getPiAgentSettings(this.plugin.settings);
    const piEnv = parseEnvironmentVariables(piSettings.environmentVariables);
    const sharedEnv = parseEnvironmentVariables(String(this.plugin.settings?.sharedEnvironmentVariables ?? ''));
    const externalEnv = this.options.getEnvironmentVariable ?? defaultAuthContextOptions.getEnvironmentVariable;
    return Promise.resolve(piEnv[name] ?? sharedEnv[name] ?? externalEnv(name));
  }

  fileExists(path: string): Promise<boolean> {
    const getHomeDirectory = this.options.getHomeDirectory ?? defaultAuthContextOptions.getHomeDirectory;
    const expanded = path.startsWith('~/')
      ? `${getHomeDirectory()}${path.slice(1)}`
      : path;
    if (!expanded) {
      return Promise.resolve(false);
    }
    try {
      const fileExists = this.options.fileExists ?? defaultAuthContextOptions.fileExists;
      return Promise.resolve(fileExists(expanded));
    } catch {
      return Promise.resolve(false);
    }
  }
}

import type {
  AuthContext,
  Credential,
  CredentialInfo,
  CredentialStore,
} from '@earendil-works/pi-ai';
import {
  getPiAiCredentialSecretId,
  listPiAiCredentialSecretIds,
  parseProviderCredential,
  serializeProviderCredential,
} from '@pivi/agent/auth/piProviderCredentials';
import { isSupportedPiProviderId } from '@pivi/agent/auth/piProviderValidation';
import { getProviderEnvVarNames, } from '@pivi/agent/auth/providerEnvVars';
import {
  clearSyncSecret,
  isSecretStorageAvailable,
  PIVI_PROVIDER_SECRET_PREFIX,
} from '@pivi/agent/auth/providerSecretStorage';
import type { AuthContextHost, SyncSecretStore } from '@pivi/agent/ports';
import { getPiAgentSettings } from '@pivi/agent/settings/agentSettings';
import { parseEnvironmentVariables } from '@pivi/agent/settings/environmentText';

import type { PiRuntimeHost } from '../runtime/piRuntimeHost';

const OAUTH_NO_EXPIRY = Number.MAX_SAFE_INTEGER;

;

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

function credentialFromEnvironment(
  env: Record<string, string>,
  providerId: string,
): Credential | undefined {
  const envVars = getProviderEnvVarNames(providerId);
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
): boolean {
  const envVars = getProviderEnvVarNames(providerId);
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

/** Moves a provider API key or OAuth token found in environment text into the keychain. */
function migrateProviderCredential(
  secretStorage: SyncSecretStore,
  providerId: string,
  env: Record<string, string>,
): { credentialsChanged: boolean; environmentChanged: boolean } {
  const envCredential = credentialFromEnvironment(env, providerId);
  if (!envCredential) {
    return { credentialsChanged: false, environmentChanged: false };
  }
  secretStorage.setSecret(getPiAiCredentialSecretId(providerId), serializeProviderCredential(envCredential));
  return {
    credentialsChanged: true,
    environmentChanged: removeCredentialEnvironmentValues(env, providerId),
  };
}

export function movePiProviderCredentialsFromEnvironment(
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
      clearSyncSecret(this.secretStorage, secretId);
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

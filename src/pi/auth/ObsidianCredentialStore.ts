import type {
  AuthContext,
  Credential,
  CredentialStore,
  OAuthCredential,
} from '@earendil-works/pi-ai';
import * as fs from 'fs';
import type { SecretStorage } from 'obsidian';

import type PiviPlugin from '../../main';
import { parseEnvironmentVariables } from '../../utils/env';
import { getPiAgentSettings } from '../settings';
import { getProviderEnvVarNames } from './providerEnvVars';
import {
  getProviderCredentialSecret,
  getProviderCredentialSecretId,
  isSecretStorageAvailable,
  PIVI_PROVIDER_SECRET_PREFIX,
  type ProviderCredentialKind,
} from './ProviderSecretStorage';

const PI_AI_CREDENTIAL_KIND = 'credential-v2';

export function getPiAiCredentialSecretId(providerId: string): string {
  return `${PIVI_PROVIDER_SECRET_PREFIX}-${providerId}-${PI_AI_CREDENTIAL_KIND}`;
}

function parsePiAiCredentialSecretId(secretId: string): string | null {
  const prefix = `${PIVI_PROVIDER_SECRET_PREFIX}-`;
  const suffix = `-${PI_AI_CREDENTIAL_KIND}`;
  if (!secretId.startsWith(prefix) || !secretId.endsWith(suffix)) {
    return null;
  }
  const providerId = secretId.slice(prefix.length, -suffix.length);
  return providerId || null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function parseStoredCredential(raw: string | null): Credential | undefined {
  if (!raw) {
    return undefined;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) {
      return undefined;
    }
    if (parsed.type === 'api-key' || parsed.type === 'oauth') {
      return parsed as Credential;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function legacyCredentialForKind(
  secretStorage: SecretStorage,
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

function readLegacyCredential(secretStorage: SecretStorage, providerId: string): Credential | undefined {
  const envVars = getProviderEnvVarNames(providerId);
  if (envVars.oauthVar) {
    const oauth = legacyCredentialForKind(secretStorage, providerId, 'oauth-token');
    if (oauth) {
      return oauth;
    }
  }
  return legacyCredentialForKind(secretStorage, providerId, 'api-key');
}

export class ObsidianCredentialStore implements CredentialStore {
  private readonly chains = new Map<string, Promise<unknown>>();

  constructor(private readonly secretStorage: SecretStorage) {}

  readSync(providerId: string): Credential | undefined {
    const stored = parseStoredCredential(
      this.secretStorage.getSecret(getPiAiCredentialSecretId(providerId)),
    );
    return stored ?? readLegacyCredential(this.secretStorage, providerId);
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
    this.secretStorage.setSecret(getPiAiCredentialSecretId(providerId), JSON.stringify(credential));
    this.clearLegacyCredential(providerId, 'api-key');
    this.clearLegacyCredential(providerId, 'oauth-token');
  }

  clearSync(providerId: string): void {
    this.secretStorage.setSecret(getPiAiCredentialSecretId(providerId), '');
    this.clearLegacyCredential(providerId, 'api-key');
    this.clearLegacyCredential(providerId, 'oauth-token');
  }

  private clearLegacyCredential(providerId: string, kind: ProviderCredentialKind): void {
    this.secretStorage.setSecret(getProviderCredentialSecretId(providerId, kind), '');
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
  secretStorage: SecretStorage | undefined,
): ObsidianCredentialStore | null {
  if (!isSecretStorageAvailable(secretStorage)) {
    return null;
  }
  return new ObsidianCredentialStore(secretStorage);
}

export function credentialToApiKey(credential: Credential | undefined): string | undefined {
  if (!credential) {
    return undefined;
  }
  if (credential.type === 'api-key') {
    return credential.key;
  }
  if (credential.type === 'oauth') {
    if (credential.expires && credential.expires < Date.now()) {
      return undefined;
    }
    return credential.access;
  }
  return undefined;
}

export function isOAuthCredential(value: Credential | undefined): value is OAuthCredential {
  return !!value && value.type === 'oauth' && typeof value.access === 'string';
}

export class ObsidianAuthContext implements AuthContext {
  constructor(private readonly plugin: PiviPlugin) {}

  env(name: string): Promise<string | undefined> {
    const piSettings = getPiAgentSettings(this.plugin.settings);
    const piEnv = parseEnvironmentVariables(piSettings.environmentVariables);
    const sharedEnv = parseEnvironmentVariables(this.plugin.settings?.sharedEnvironmentVariables ?? '');
    return Promise.resolve(piEnv[name] ?? sharedEnv[name] ?? process.env[name]);
  }

  fileExists(path: string): Promise<boolean> {
    const expanded = path.startsWith('~/')
      ? `${process.env.HOME ?? ''}${path.slice(1)}`
      : path;
    if (!expanded) {
      return Promise.resolve(false);
    }
    try {
      return Promise.resolve(fs.existsSync(expanded));
    } catch {
      return Promise.resolve(false);
    }
  }
}

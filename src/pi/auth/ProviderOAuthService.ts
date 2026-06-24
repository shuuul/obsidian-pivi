import type { Credential, OAuthCredential } from '@earendil-works/pi-ai';
import * as fs from 'fs';
import type { App } from 'obsidian';

import { getVaultPath } from '../../utils/path';
import { openAuthUrl } from '../mcp/oauth/openAuthUrl';
import { piAiModels } from '../piAiModels';
import {
  credentialToApiKey,
  isOAuthCredential,
  type ObsidianCredentialStore,
} from './ObsidianCredentialStore';

/** Provider id for OpenAI Codex subscription OAuth (pi-ai). */
export const CODEX_OAUTH_PROVIDER_ID = 'openai-codex';

const OBSIUS_AUTH_FILE = '.obsius/auth.json';
type LegacyAuthData = Record<string, Credential>;

/** Provider OAuth. v1: OpenAI Codex only; SecretStorage is authoritative. */
export class ProviderOAuthService {
  private authPath: string | null = null;

  constructor(
    private readonly app: App,
    private readonly credentialStore: ObsidianCredentialStore | null = null,
  ) {}

  private resolveAuthPath(): string | null {
    const vaultPath = getVaultPath(this.app);
    if (!vaultPath) {
      return null;
    }
    return `${vaultPath}/${OBSIUS_AUTH_FILE}`;
  }

  /** Whether Codex OAuth credentials exist in SecretStorage or legacy vault auth.json. */
  hasCodexAuth(): boolean {
    const stored = this.credentialStore?.readSync(CODEX_OAUTH_PROVIDER_ID);
    if (isOAuthCredential(stored)) {
      return true;
    }
    const legacy = this.readLegacyCodexCredential();
    if (legacy) {
      if (this.credentialStore) {
        this.credentialStore.writeSync(CODEX_OAUTH_PROVIDER_ID, legacy);
        this.clearLegacyCodexCredential();
      }
      return true;
    }
    return false;
  }

  /** Codex API key / access token (refreshes via pi-ai credential lifecycle where possible). */
  async getCodexApiKey(): Promise<string | undefined> {
    const model = piAiModels.getModels(CODEX_OAUTH_PROVIDER_ID)[0];
    if (model) {
      try {
        const resolved = await piAiModels.getAuth(model);
        if (resolved?.auth.apiKey) {
          return resolved.auth.apiKey;
        }
      } catch {
        return undefined;
      }
    }
    return credentialToApiKey(this.credentialStore?.readSync(CODEX_OAUTH_PROVIDER_ID));
  }

  /** Synchronous read for pi-agent getApiKey callback (no refresh). */
  getCodexAccessTokenSync(): string | undefined {
    const stored = this.credentialStore?.readSync(CODEX_OAUTH_PROVIDER_ID);
    const apiKey = credentialToApiKey(stored);
    if (apiKey) {
      return apiKey;
    }
    const legacy = this.readLegacyCodexCredential();
    if (legacy) {
      if (this.credentialStore) {
        this.credentialStore.writeSync(CODEX_OAUTH_PROVIDER_ID, legacy);
        this.clearLegacyCodexCredential();
      }
      const migratedKey = credentialToApiKey(legacy);
      return migratedKey;
    }
    return undefined;
  }

  /** Start OpenAI Codex OAuth; opens system browser from Obsidian. */
  async loginCodex(onProgress?: (message: string) => void): Promise<void> {
    if (!this.credentialStore) {
      throw new Error('Obsidian SecretStorage is unavailable for provider OAuth.');
    }
    const oauth = piAiModels.getProvider(CODEX_OAUTH_PROVIDER_ID)?.auth.oauth;
    if (!oauth) {
      throw new Error('OpenAI Codex OAuth is unavailable.');
    }

    const credential = await oauth.login({
      notify: (event) => {
        if (event.type === 'auth_url') {
          onProgress?.('Opening browser for OpenAI Codex sign-in…');
          openAuthUrl(event.url);
        } else if (event.type === 'device_code') {
          onProgress?.('Waiting for Codex authorization…');
        } else {
          onProgress?.(event.message);
        }
      },
      prompt: (prompt) => {
        onProgress?.(prompt.message ?? 'Complete sign-in in the browser.');
        return Promise.resolve('');
      },
    });

    await this.credentialStore.modify(CODEX_OAUTH_PROVIDER_ID, () => Promise.resolve(credential));
    this.clearLegacyCodexCredential();
  }

  logoutCodex(): void {
    void this.credentialStore?.delete(CODEX_OAUTH_PROVIDER_ID);
    this.clearLegacyCodexCredential();
  }

  getAuthFilePath(): string | null {
    return this.authPath ?? this.resolveAuthPath();
  }

  private readLegacyCodexCredential(): OAuthCredential | undefined {
    const path = this.getAuthFilePath();
    if (!path || !fs.existsSync(path)) {
      return undefined;
    }
    try {
      const raw = fs.readFileSync(path, 'utf-8');
      const data = JSON.parse(raw) as LegacyAuthData;
      const cred = data[CODEX_OAUTH_PROVIDER_ID];
      return isOAuthCredential(cred) ? cred : undefined;
    } catch {
      return undefined;
    }
  }

  private clearLegacyCodexCredential(): void {
    const path = this.getAuthFilePath();
    if (!path || !fs.existsSync(path)) {
      return;
    }
    try {
      const raw = fs.readFileSync(path, 'utf-8');
      const data = JSON.parse(raw) as LegacyAuthData;
      if (!(CODEX_OAUTH_PROVIDER_ID in data)) {
        return;
      }
      delete data[CODEX_OAUTH_PROVIDER_ID];
      fs.writeFileSync(path, JSON.stringify(data, null, 2), { encoding: 'utf-8', mode: 0o600 });
    } catch {
      // Best-effort cleanup only; SecretStorage remains authoritative.
    }
  }
}

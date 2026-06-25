import type { Credential, OAuthCredential } from '@earendil-works/pi-ai';
import {
  OPENAI_CODEX_BROWSER_LOGIN_METHOD,
  openaiCodexOAuthProvider,
} from '@earendil-works/pi-ai/oauth';
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
const CODEX_BROWSER_OAUTH_SCOPE = 'openid profile email offline_access api.connectors.read api.connectors.invoke';
const CODEX_BROWSER_OAUTH_ORIGINATOR = 'codex_cli_rs';
type LegacyAuthData = Record<string, Credential>;

export function normalizeCodexBrowserAuthUrl(url: string): string {
  const parsed = new URL(url);
  parsed.searchParams.set('scope', CODEX_BROWSER_OAUTH_SCOPE);
  parsed.searchParams.set('originator', CODEX_BROWSER_OAUTH_ORIGINATOR);
  return parsed.toString();
}

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

  /** Synchronous read for settings/status UI only; runtime requests resolve auth through pi-ai. */
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

    const oauthCredentials = await openaiCodexOAuthProvider.login({
      onAuth: (info) => {
        onProgress?.('Opening browser for OpenAI Codex sign-in…');
        openAuthUrl(normalizeCodexBrowserAuthUrl(info.url));
      },
      onDeviceCode: (info) => {
        onProgress?.(`Open ${info.verificationUri} and enter code ${info.userCode}.`);
        openAuthUrl(info.verificationUri);
      },
      onProgress,
      onPrompt: (prompt) => {
        onProgress?.(prompt.message ?? 'Complete sign-in in the browser.');
        return Promise.reject(
          new Error('Codex login did not complete in the browser. Ensure the localhost callback is reachable, then try again.'),
        );
      },
      onSelect: () => Promise.resolve(OPENAI_CODEX_BROWSER_LOGIN_METHOD),
    });
    const credential: OAuthCredential = { ...oauthCredentials, type: 'oauth' };

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

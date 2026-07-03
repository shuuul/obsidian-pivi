import type { OAuthCredential } from '@earendil-works/pi-ai';
import {
  OPENAI_CODEX_BROWSER_LOGIN_METHOD,
  openaiCodexOAuthProvider,
} from '@earendil-works/pi-ai/oauth';
import {
  CODEX_OAUTH_PROVIDER_ID,
  credentialToApiKey,
  isOAuthCredential,
} from '@pivi/pivi-agent-core/auth/piProviderCredentials';
import { piAiModels } from '@pivi/pivi-agent-core/engine/pi/piAiModels';
import type { OAuthFlowHost, ProviderLegacyAuthStore } from '@pivi/pivi-agent-core/ports';

import type { ObsidianCredentialStore } from './piProviderCredentialStore';

export { CODEX_OAUTH_PROVIDER_ID };


export function normalizeCodexBrowserAuthUrl(url: string): string {
  // Keep browser login byte-for-byte aligned with pi-ai/pi-coding-agent.
  // OpenAI's consent pages are Cloudflare/Remix protected; even harmless-looking
  // parameter rewrites can route re-auth through consent.data and produce HTML
  // route errors instead of the localhost OAuth callback.
  return new URL(url).toString();
}

/** Provider OAuth. v1: OpenAI Codex only; SecretStorage is authoritative. */
export class ProviderOAuthService {
  constructor(
    private readonly credentialStore: ObsidianCredentialStore | null,
    private readonly oauthHost: OAuthFlowHost,
    private readonly legacyAuthStore: ProviderLegacyAuthStore | null = null,
  ) {}

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

  /** Start OpenAI Codex OAuth through the injected host OAuth flow. */
  async loginCodex(onProgress?: (message: string) => void): Promise<void> {
    if (!this.credentialStore) {
      throw new Error('Obsidian SecretStorage is unavailable for provider OAuth.');
    }

    const notify = (message: string): void => {
      onProgress?.(message);
      this.oauthHost.notify?.(message);
    };

    const oauthCredentials = await openaiCodexOAuthProvider.login({
      onAuth: (info) => {
        notify('Opening browser for OpenAI Codex sign-in…');
        void this.oauthHost.openAuthUrl(normalizeCodexBrowserAuthUrl(info.url)).catch((error: unknown) => {
          console.warn('Pivi: failed to open Codex OAuth URL', error);
        });
      },
      onDeviceCode: (info) => {
        notify(`Open ${info.verificationUri} and enter code ${info.userCode}.`);
        void this.oauthHost.openAuthUrl(info.verificationUri).catch((error: unknown) => {
          console.warn('Pivi: failed to open Codex device-code URL', error);
        });
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


  private readLegacyCodexCredential(): OAuthCredential | undefined {
    const data = this.legacyAuthStore?.read();
    if (!data) {
      return undefined;
    }
    const cred = data[CODEX_OAUTH_PROVIDER_ID];
    if (
      !isOAuthCredential(cred)
      || typeof cred.refresh !== 'string'
      || typeof cred.expires !== 'number'
    ) {
      return undefined;
    }
    return { type: 'oauth', access: cred.access, refresh: cred.refresh, expires: cred.expires };
  }

  private clearLegacyCodexCredential(): void {
    const data = this.legacyAuthStore?.read();
    if (!data || !(CODEX_OAUTH_PROVIDER_ID in data)) {
      return;
    }
    try {
      delete data[CODEX_OAUTH_PROVIDER_ID];
      this.legacyAuthStore?.write(data);
    } catch {
      // Best-effort cleanup only; SecretStorage remains authoritative.
    }
  }
}

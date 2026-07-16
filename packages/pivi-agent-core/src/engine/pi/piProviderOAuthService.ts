import {
  CODEX_OAUTH_PROVIDER_ID,
  credentialToApiKey,
  isOAuthCredential,
} from '../../auth/piProviderCredentials';
import { PluginLogger } from '../../foundation/pluginLogger';
import type { OAuthFlowHost, ProviderLegacyAuthStore } from '../../ports';
import { piAiModels } from './piAiModels';
import { createPiAuthInteraction } from './piAuthInteraction';
import type { ObsidianCredentialStore } from './piProviderCredentialStore';

const logger = new PluginLogger('ProviderOAuthService');

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

    await piAiModels.login(
      CODEX_OAUTH_PROVIDER_ID,
      'oauth',
      createPiAuthInteraction({
        oauthHost: this.oauthHost,
        onProgress,
        normalizeAuthUrl: normalizeCodexBrowserAuthUrl,
      }),
    );
    this.clearLegacyCodexCredential();
  }

  logoutCodex(): void {
    void piAiModels.logout(CODEX_OAUTH_PROVIDER_ID).catch((error: unknown) => {
      logger.warn('failed to logout Codex OAuth through pi-ai', error);
    });
    void this.credentialStore?.delete(CODEX_OAUTH_PROVIDER_ID);
    this.clearLegacyCodexCredential();
  }


  private readLegacyCodexCredential() {
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
    return { type: 'oauth' as const, access: cred.access, refresh: cred.refresh, expires: cred.expires };
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

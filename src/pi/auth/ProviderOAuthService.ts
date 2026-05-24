import type { OAuthLoginCallbacks } from '@earendil-works/pi-ai/oauth';
import { AuthStorage } from '@earendil-works/pi-coding-agent/dist/core/auth-storage.js';
import * as fs from 'fs';
import type { App } from 'obsidian';

import { getVaultPath } from '../../utils/path';
import { openAuthUrl } from '../mcp/oauth/openAuthUrl';

/** Provider id for OpenAI Codex subscription OAuth (pi-ai). */
export const CODEX_OAUTH_PROVIDER_ID = 'openai-codex';

const OBSIUS_AUTH_FILE = '.obsius/auth.json';

/**
 * Vault-local provider OAuth. v1: OpenAI Codex only.
 * Separate from MCP OAuth (`.obsius/mcp-oauth/`).
 */
export class ProviderOAuthService {
  private authStorage: AuthStorage | null = null;
  private authPath: string | null = null;

  constructor(private readonly app: App) {}

  private resolveAuthPath(): string | null {
    const vaultPath = getVaultPath(this.app);
    if (!vaultPath) {
      return null;
    }
    return `${vaultPath}/${OBSIUS_AUTH_FILE}`;
  }

  private ensureStorage(): AuthStorage {
    if (this.authStorage) {
      return this.authStorage;
    }
    const authPath = this.resolveAuthPath();
    if (!authPath) {
      throw new Error('Vault path unavailable for provider OAuth storage.');
    }
    this.authPath = authPath;
    this.authStorage = AuthStorage.create(this.authPath);
    return this.authStorage;
  }

  /** Whether Codex OAuth credentials exist in vault auth.json. */
  hasCodexAuth(): boolean {
    try {
      return this.ensureStorage().hasAuth(CODEX_OAUTH_PROVIDER_ID);
    } catch {
      return false;
    }
  }

  /** Codex API key / access token (refreshes when expired). */
  async getCodexApiKey(): Promise<string | undefined> {
    try {
      return await this.ensureStorage().getApiKey(CODEX_OAUTH_PROVIDER_ID);
    } catch {
      return undefined;
    }
  }

  /** Synchronous read for pi-agent getApiKey callback (no refresh). */
  getCodexAccessTokenSync(): string | undefined {
    const path = this.getAuthFilePath();
    if (!path || !fs.existsSync(path)) {
      return undefined;
    }
    try {
      const raw = fs.readFileSync(path, 'utf-8');
      const data = JSON.parse(raw) as Record<string, { type?: string; access?: string; expires?: number }>;
      const cred = data[CODEX_OAUTH_PROVIDER_ID];
      if (!cred || cred.type !== 'oauth') {
        return undefined;
      }
      if (cred.expires && cred.expires < Date.now()) {
        return undefined;
      }
      return cred.access;
    } catch {
      return undefined;
    }
  }

  /** Start OpenAI Codex OAuth; opens system browser from Obsidian. */
  async loginCodex(onProgress?: (message: string) => void): Promise<void> {
    const storage = this.ensureStorage();
    const callbacks: OAuthLoginCallbacks = {
      onAuth: (info) => {
        onProgress?.('Opening browser for OpenAI Codex sign-in…');
        openAuthUrl(info.url);
      },
      onDeviceCode: () => {
        onProgress?.('Waiting for Codex authorization…');
      },
      onPrompt: async (prompt) => {
        onProgress?.(prompt.message ?? 'Complete sign-in in the browser.');
        return '';
      },
      onSelect: async () => undefined,
      onProgress: (msg) => onProgress?.(msg),
    };

    await storage.login(CODEX_OAUTH_PROVIDER_ID, callbacks);
  }

  logoutCodex(): void {
    try {
      this.ensureStorage().logout(CODEX_OAUTH_PROVIDER_ID);
    } catch {
      // ignore
    }
  }

  getAuthFilePath(): string | null {
    return this.authPath ?? this.resolveAuthPath();
  }
}

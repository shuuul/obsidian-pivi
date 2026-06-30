import { createHash } from 'crypto';

import type { VaultFileAdapter } from '../../../core/storage/VaultFileAdapter';
import { PIVI_MCP_OAUTH_DIR } from '../paths';

export interface StoredTokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  scope?: string;
}

export interface StoredClientInfo {
  clientId: string;
  clientSecret?: string;
  clientIdIssuedAt?: number;
  clientSecretExpiresAt?: number;
}

export interface AuthEntry {
  tokens?: StoredTokens;
  clientInfo?: StoredClientInfo;
  codeVerifier?: string;
  oauthState?: string;
  serverUrl?: string;
}

export class McpVaultAuthStore {
  constructor(private readonly adapter: VaultFileAdapter) {}

  private serverDir(serverName: string): string {
    const storageKey = createHash('sha256').update(serverName, 'utf8').digest('hex');
    return `${PIVI_MCP_OAUTH_DIR}/sha256-${storageKey}`;
  }

  private entryPath(serverName: string): string {
    return `${this.serverDir(serverName)}/tokens.json`;
  }

  async getEntry(serverName: string): Promise<AuthEntry | undefined> {
    const path = this.entryPath(serverName);
    if (!(await this.adapter.exists(path))) {
      return undefined;
    }
    try {
      const raw = await this.adapter.read(path);
      const parsed: unknown = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        return parsed;
      }
    } catch {
      return undefined;
    }
    return undefined;
  }

  async getAuthForUrl(serverName: string, serverUrl: string): Promise<AuthEntry | undefined> {
    const entry = await this.getEntry(serverName);
    if (!entry?.serverUrl || entry.serverUrl !== serverUrl) {
      return undefined;
    }
    return entry;
  }

  async saveEntry(serverName: string, entry: AuthEntry, serverUrl?: string): Promise<void> {
    if (serverUrl) {
      entry.serverUrl = serverUrl;
    }
    await this.adapter.ensureFolder(PIVI_MCP_OAUTH_DIR);
    await this.adapter.ensureFolder(this.serverDir(serverName));
    await this.adapter.write(this.entryPath(serverName), `${JSON.stringify(entry, null, 2)}\n`);
  }

  async removeEntry(serverName: string): Promise<void> {
    const path = this.entryPath(serverName);
    await this.adapter.delete(path);
    await this.adapter.deleteFolder(this.serverDir(serverName));
  }

  async updateTokens(serverName: string, tokens: StoredTokens, serverUrl?: string): Promise<void> {
    const entry = (await this.getEntry(serverName)) ?? {};
    if (serverUrl && entry.serverUrl !== serverUrl) {
      delete entry.clientInfo;
      delete entry.codeVerifier;
      delete entry.oauthState;
    }
    entry.tokens = tokens;
    await this.saveEntry(serverName, entry, serverUrl);
  }

  async updateClientInfo(
    serverName: string,
    clientInfo: StoredClientInfo,
    serverUrl?: string,
  ): Promise<void> {
    const entry = (await this.getEntry(serverName)) ?? {};
    if (serverUrl && entry.serverUrl !== serverUrl) {
      delete entry.tokens;
      delete entry.codeVerifier;
      delete entry.oauthState;
    }
    entry.clientInfo = clientInfo;
    await this.saveEntry(serverName, entry, serverUrl);
  }

  async updateCodeVerifier(serverName: string, codeVerifier: string, serverUrl?: string): Promise<void> {
    const entry = (await this.getEntry(serverName)) ?? {};
    if (serverUrl && entry.serverUrl !== serverUrl) {
      delete entry.tokens;
      delete entry.clientInfo;
      delete entry.oauthState;
    }
    entry.codeVerifier = codeVerifier;
    await this.saveEntry(serverName, entry, serverUrl);
  }

  async clearCodeVerifier(serverName: string): Promise<void> {
    const entry = await this.getEntry(serverName);
    if (!entry) {
      return;
    }
    delete entry.codeVerifier;
    await this.saveEntry(serverName, entry);
  }

  async updateOAuthState(serverName: string, state: string, serverUrl?: string): Promise<void> {
    const entry = (await this.getEntry(serverName)) ?? {};
    if (serverUrl && entry.serverUrl !== serverUrl) {
      delete entry.tokens;
      delete entry.clientInfo;
      delete entry.codeVerifier;
    }
    entry.oauthState = state;
    await this.saveEntry(serverName, entry, serverUrl);
  }

  async getOAuthState(serverName: string): Promise<string | undefined> {
    return (await this.getEntry(serverName))?.oauthState;
  }

  async clearOAuthState(serverName: string): Promise<void> {
    const entry = await this.getEntry(serverName);
    if (!entry) {
      return;
    }
    delete entry.oauthState;
    await this.saveEntry(serverName, entry);
  }

  async isTokenExpired(serverName: string): Promise<boolean | null> {
    const entry = await this.getEntry(serverName);
    if (!entry?.tokens) {
      return null;
    }
    if (!entry.tokens.expiresAt) {
      return false;
    }
    return entry.tokens.expiresAt < Date.now() / 1000;
  }

  async hasStoredTokens(serverName: string): Promise<boolean> {
    return !!(await this.getEntry(serverName))?.tokens;
  }

  async clearClientInfo(serverName: string): Promise<void> {
    const entry = await this.getEntry(serverName);
    if (!entry) {
      return;
    }
    delete entry.clientInfo;
    await this.saveEntry(serverName, entry);
  }

  async clearTokens(serverName: string): Promise<void> {
    const entry = await this.getEntry(serverName);
    if (!entry) {
      return;
    }
    delete entry.tokens;
    await this.saveEntry(serverName, entry);
  }
}

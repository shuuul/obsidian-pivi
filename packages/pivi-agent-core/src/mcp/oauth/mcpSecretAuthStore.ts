import type { SyncSecretStore } from '../../ports';
import type {
  AuthEntry,
  McpAuthEntryStore,
  StoredClientInfo,
  StoredTokens,
} from './mcpVaultAuthStore';

export const MCP_AUTH_ENTRY_SECRET_VERSION = 1 as const;

interface StoredMcpAuthEntryPayloadV1 {
  version: typeof MCP_AUTH_ENTRY_SECRET_VERSION;
  entry: AuthEntry;
}

const MCP_AUTH_SECRET_PREFIX = 'pivi-mcp-oauth';

function encodeServerName(serverName: string): string {
  return Array.from(new TextEncoder().encode(serverName))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export function getMcpAuthEntrySecretId(serverName: string): string {
  return `${MCP_AUTH_SECRET_PREFIX}-${encodeServerName(serverName)}-auth-v${MCP_AUTH_ENTRY_SECRET_VERSION}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function parseStoredEntry(raw: string | null | undefined): AuthEntry | undefined {
  if (!raw?.trim()) {
    return undefined;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed) || parsed.version !== MCP_AUTH_ENTRY_SECRET_VERSION) {
      return undefined;
    }
    const entry = parsed.entry;
    if (!isRecord(entry)) {
      return undefined;
    }
    return entry;
  } catch {
    return undefined;
  }
}

function serializeStoredEntry(entry: AuthEntry): string {
  const payload: StoredMcpAuthEntryPayloadV1 = {
    version: MCP_AUTH_ENTRY_SECRET_VERSION,
    entry,
  };
  return JSON.stringify(payload);
}

/** SecretStorage-backed MCP OAuth auth entry store. */
export class McpSecretAuthStore implements McpAuthEntryStore {
  constructor(private readonly secretStorage: SyncSecretStore) {}

  async getEntry(serverName: string): Promise<AuthEntry | undefined> {
    return parseStoredEntry(this.secretStorage.getSecret(getMcpAuthEntrySecretId(serverName)));
  }

  async getAuthForUrl(
    serverName: string,
    serverUrl: string,
  ): Promise<AuthEntry | undefined> {
    const entry = await this.getEntry(serverName);
    if (!entry?.serverUrl || entry.serverUrl !== serverUrl) {
      return undefined;
    }
    return entry;
  }

  async saveEntry(
    serverName: string,
    entry: AuthEntry,
    serverUrl?: string,
  ): Promise<void> {
    const next: AuthEntry = { ...entry };
    if (serverUrl) {
      next.serverUrl = serverUrl;
    }
    this.secretStorage.setSecret(
      getMcpAuthEntrySecretId(serverName),
      serializeStoredEntry(next),
    );
  }

  async removeEntry(serverName: string): Promise<void> {
    this.secretStorage.setSecret(getMcpAuthEntrySecretId(serverName), '');
  }

  async updateTokens(
    serverName: string,
    tokens: StoredTokens,
    serverUrl?: string,
  ): Promise<void> {
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

  async updateCodeVerifier(
    serverName: string,
    codeVerifier: string,
    serverUrl?: string,
  ): Promise<void> {
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

  async updateOAuthState(
    serverName: string,
    state: string,
    serverUrl?: string,
  ): Promise<void> {
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

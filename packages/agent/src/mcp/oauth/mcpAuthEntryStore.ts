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
  /**
   * Scope a server demanded through an `insufficient_scope` challenge. The transport cannot open a
   * browser, so the next interactive sign-in requests it instead of refreshing the narrower grant.
   */
  stepUpScope?: string;
}

export interface McpAuthEntryStore {
  getEntry(serverName: string): Promise<AuthEntry | undefined>;
  getAuthForUrl(serverName: string, serverUrl: string): Promise<AuthEntry | undefined>;
  saveEntry(serverName: string, entry: AuthEntry, serverUrl?: string): Promise<void>;
  removeEntry(serverName: string): Promise<void>;
  updateTokens(serverName: string, tokens: StoredTokens, serverUrl?: string): Promise<void>;
  updateClientInfo(serverName: string, clientInfo: StoredClientInfo, serverUrl?: string): Promise<void>;
  updateCodeVerifier(serverName: string, codeVerifier: string, serverUrl?: string): Promise<void>;
  clearCodeVerifier(serverName: string): Promise<void>;
  updateOAuthState(serverName: string, state: string, serverUrl?: string): Promise<void>;
  getOAuthState(serverName: string): Promise<string | undefined>;
  clearOAuthState(serverName: string): Promise<void>;
  updateStepUpScope(serverName: string, scope: string, serverUrl: string): Promise<void>;
  clearStepUpScope(serverName: string): Promise<void>;
  isTokenExpired(serverName: string): Promise<boolean | null>;
  hasStoredTokens(serverName: string): Promise<boolean>;
  clearClientInfo(serverName: string): Promise<void>;
  clearTokens(serverName: string): Promise<void>;
}

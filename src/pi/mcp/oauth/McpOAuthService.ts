import type { OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js';

import type { AppMcpOAuth } from '../../../core/agent/types';
import type { VaultFileAdapter } from '../../../core/storage/VaultFileAdapter';
import type { ManagedMcpServer, McpAuthStatus, McpOAuthConfig } from '../../../core/types';
import { getMcpServerUrl, supportsMcpOAuth } from '../../../core/types';
import {
  authenticate,
  getAuthStatusForServer,
  removeAuth,
} from './McpAuthFlow';
import { McpOAuthProvider } from './McpOAuthProvider';
import { McpVaultAuthStore } from './McpVaultAuthStore';

export class McpOAuthService implements AppMcpOAuth {
  private readonly store: McpVaultAuthStore;

  constructor(adapter: VaultFileAdapter) {
    this.store = new McpVaultAuthStore(adapter);
  }

  async getAuthStatus(server: ManagedMcpServer): Promise<McpAuthStatus> {
    if (!supportsMcpOAuth(server)) {
      return 'not_applicable';
    }
    return getAuthStatusForServer(server.name, this.store);
  }

  async authenticate(server: ManagedMcpServer): Promise<McpAuthStatus> {
    if (!supportsMcpOAuth(server)) {
      return 'not_applicable';
    }
    return authenticate(server, this.store);
  }

  async logout(serverName: string): Promise<void> {
    await removeAuth(serverName, this.store);
  }

  createAuthProvider(server: ManagedMcpServer): OAuthClientProvider | null {
    if (!supportsMcpOAuth(server)) {
      return null;
    }
    const serverUrl = getMcpServerUrl(server.config);
    if (!serverUrl) {
      return null;
    }

    const config: McpOAuthConfig = server.oauth === false
      ? {}
      : (server.oauth && typeof server.oauth === 'object' ? server.oauth : {});

    return new McpOAuthProvider(server.name, serverUrl, config, this.store, {
      onRedirect: async () => {
        throw new Error('Authenticate this MCP server from settings.');
      },
    });
  }
}

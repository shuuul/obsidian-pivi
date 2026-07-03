import type { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import type { ExternalOpener } from "@pivi/pivi-agent-core/ports";

import type { AppMcpOAuth, FileStore, McpTransportFetch } from "../ports";
import type {
  ManagedMcpServer,
  McpAuthStatus,
  McpOAuthConfig,
} from "../types";
import { getMcpServerUrl, supportsMcpOAuth } from "../types";
import {
  authenticate,
  getAuthStatusForServer,
  removeAuth,
} from "./mcpAuthFlow";
import { configureOAuthCallbackPort, McpOAuthProvider } from "./mcpOAuthProvider";
import { McpVaultAuthStore } from "./mcpVaultAuthStore";

export interface McpOAuthServiceOptions {
  callbackPort?: number;
}

export class McpOAuthService implements AppMcpOAuth {
  private readonly store: McpVaultAuthStore;

  constructor(
    adapter: FileStore,
    private readonly fetch: McpTransportFetch,
    private readonly externalOpener: ExternalOpener,
    options: McpOAuthServiceOptions = {},
  ) {
    configureOAuthCallbackPort(options.callbackPort);
    this.store = new McpVaultAuthStore(adapter);
  }

  async getAuthStatus(server: ManagedMcpServer): Promise<McpAuthStatus> {
    if (!supportsMcpOAuth(server)) {
      return "not_applicable";
    }
    return getAuthStatusForServer(server.name, this.store);
  }

  async authenticate(server: ManagedMcpServer): Promise<McpAuthStatus> {
    if (!supportsMcpOAuth(server)) {
      return "not_applicable";
    }
    return authenticate(server, this.store, this.fetch, this.externalOpener);
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

    const config: McpOAuthConfig =
      server.oauth === false
        ? {}
        : server.oauth && typeof server.oauth === "object"
          ? server.oauth
          : {};

    return new McpOAuthProvider(server.name, serverUrl, config, this.store, {
      onRedirect: () =>
        Promise.reject(
          new Error("Authenticate this MCP server from settings."),
        ),
    });
  }
}

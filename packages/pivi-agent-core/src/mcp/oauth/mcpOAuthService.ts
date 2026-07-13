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
  getAuthStatusForServer,
  McpAuthFlow,
} from "./mcpAuthFlow";
import { McpOAuthProvider } from "./mcpOAuthProvider";
import { McpVaultAuthStore } from "./mcpVaultAuthStore";

export interface McpOAuthServiceOptions {
  callbackPort?: number;
}

export class McpOAuthService implements AppMcpOAuth {
  private readonly store: McpVaultAuthStore;
  private readonly authFlow: McpAuthFlow;

  constructor(
    adapter: FileStore,
    private readonly fetch: McpTransportFetch,
    private readonly externalOpener: ExternalOpener,
    options: McpOAuthServiceOptions = {},
  ) {
    this.store = new McpVaultAuthStore(adapter);
    this.authFlow = new McpAuthFlow(options.callbackPort);
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
    return this.authFlow.authenticate(server, this.store, this.fetch, this.externalOpener);
  }

  async logout(serverName: string): Promise<void> {
    await this.authFlow.removeAuth(serverName, this.store);
  }

  async dispose(): Promise<void> {
    await this.authFlow.shutdown();
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

    return new McpOAuthProvider(
      server.name,
      serverUrl,
      config,
      this.store,
      {
        onRedirect: () =>
          Promise.reject(
            new Error("Authenticate this MCP server from settings."),
          ),
      },
      this.authFlow.callbackServer.port,
    );
  }
}

import type { AuthProvider } from "@earendil-works/pi-mcp";
import { adaptOAuthProvider } from "@earendil-works/pi-mcp/oauth";

import type { ExternalOpener, SyncSecretStore } from "../../ports";
import type { AppMcpOAuth, McpTransportFetch } from "../ports";
import type {
  ManagedMcpServer,
  McpAuthStatus,
  McpOAuthConfig,
} from "../types";
import { getMcpServerUrl, supportsMcpOAuth } from "../types";
import type { McpAuthEntryStore } from "./mcpAuthEntryStore";
import {
  getAuthStatusForServer,
  McpAuthFlow,
} from "./mcpAuthFlow";
import { createClientCredentialsAuthProvider } from "./mcpClientCredentials";
import { McpOAuthProvider } from "./mcpOAuthProvider";
import { McpSecretAuthStore } from "./mcpSecretAuthStore";

export interface McpOAuthServiceOptions {
  callbackPort?: number;
}

export class McpOAuthService implements AppMcpOAuth {
  private readonly store: McpAuthEntryStore;
  private readonly authFlow: McpAuthFlow;

  constructor(
    secretStorage: SyncSecretStore,
    private readonly fetch: McpTransportFetch,
    private readonly externalOpener: ExternalOpener,
    options: McpOAuthServiceOptions = {},
  ) {
    this.store = new McpSecretAuthStore(secretStorage);
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

  /** Transport auth: refresh on 401, or re-run the client-credentials grant. */
  createAuthProvider(server: ManagedMcpServer): AuthProvider | null {
    const provider = this.createOAuthClientProvider(server);
    if (!provider) {
      return null;
    }
    const config = server.oauth && typeof server.oauth === "object" ? server.oauth : {};
    return config.grantType === "client_credentials"
      ? createClientCredentialsAuthProvider(provider, config.scope)
      : adaptOAuthProvider(provider);
  }

  /** Stored OAuth client state for one server URL. */
  createOAuthClientProvider(server: ManagedMcpServer): McpOAuthProvider | null {
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

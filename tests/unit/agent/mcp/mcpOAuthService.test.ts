import type { ManagedMcpServer } from "@pivi/agent/mcp/types";
import type { McpTransportFetch } from "@pivi/agent/mcp/ports";
import type { ExternalOpener } from "@pivi/agent/ports";
import { McpOAuthService } from "@pivi/agent/mcp/oauth/mcpOAuthService";
import { McpSecretAuthStore } from "@pivi/agent/mcp/oauth/mcpSecretAuthStore";

import { createMockApp } from "../../../helpers/mockApp";

function oauthServer(name: string, url: string): ManagedMcpServer {
  return {
    name,
    config: { type: "http", url },
    enabled: true,
    contextSaving: true,
    auth: "oauth",
  };
}

function bearerServer(name = "local"): ManagedMcpServer {
  return {
    name,
    config: { type: "http", url: "https://mcp.example.com" },
    enabled: true,
    contextSaving: true,
    auth: "bearer",
    bearerToken: "token",
  };
}

const mockExternalOpener: ExternalOpener = {
  openExternalUrl: jest.fn().mockResolvedValue(undefined),
};

describe("McpOAuthService", () => {
  it("returns not_applicable for non-OAuth servers", async () => {
    const mockFetch = jest.fn() as unknown as McpTransportFetch;
    const app = createMockApp();
    const service = new McpOAuthService(app.secretStorage, mockFetch, mockExternalOpener);
    const server = bearerServer();

    await expect(service.getAuthStatus(server)).resolves.toBe("not_applicable");
    await expect(service.authenticate(server)).resolves.toBe("not_applicable");
    expect(service.createAuthProvider(server)).toBeNull();
  });

  it("returns not_authenticated when OAuth server has no stored tokens", async () => {
    const mockFetch = jest.fn() as unknown as McpTransportFetch;
    const app = createMockApp();
    const service = new McpOAuthService(app.secretStorage, mockFetch, mockExternalOpener);

    await expect(
      service.getAuthStatus(oauthServer("github", "https://mcp.example.com")),
    ).resolves.toBe("not_authenticated");
  });

  it("returns expired when stored OAuth tokens are past expiresAt", async () => {
    const mockFetch = jest.fn() as unknown as McpTransportFetch;
    const app = createMockApp();
    const store = new McpSecretAuthStore(app.secretStorage);
    await store.updateTokens(
      "github",
      {
        accessToken: "expired-token",
        expiresAt: Math.floor(Date.now() / 1000) - 60,
      },
      "https://mcp.example.com",
    );
    const service = new McpOAuthService(app.secretStorage, mockFetch, mockExternalOpener);

    await expect(
      service.getAuthStatus(oauthServer("github", "https://mcp.example.com")),
    ).resolves.toBe("expired");
  });

  it("scopes MCP OAuth tokens by server URL through created auth providers", async () => {
    const mockFetch = jest.fn() as unknown as McpTransportFetch;
    const app = createMockApp();
    const service = new McpOAuthService(app.secretStorage, mockFetch, mockExternalOpener);
    const originalProvider = service.createOAuthClientProvider(
      oauthServer("github", "https://mcp.example.com"),
    );
    const movedProvider = service.createOAuthClientProvider(
      oauthServer("github", "https://other.example.com"),
    );

    expect(originalProvider).not.toBeNull();
    expect(movedProvider).not.toBeNull();

    await originalProvider!.saveTokens({
      access_token: "mcp-token",
      token_type: "Bearer",
      refresh_token: "refresh-token",
      expires_in: 3600,
      scope: "repo",
    });

    await expect(originalProvider!.tokens()).resolves.toMatchObject({
      access_token: "mcp-token",
      refresh_token: "refresh-token",
      scope: "repo",
    });
    await expect(movedProvider!.tokens()).resolves.toBeUndefined();
    await expect(
      service.createAuthProvider(oauthServer("github", "https://mcp.example.com"))!.token(),
    ).resolves.toBe("mcp-token");
  });

  it("uses the injected callback port for auth provider redirect URLs", () => {
    const mockFetch = jest.fn() as unknown as McpTransportFetch;
    const app = createMockApp();
    const service = new McpOAuthService(
      app.secretStorage,
      mockFetch,
      mockExternalOpener,
      { callbackPort: 34567 },
    );

    const provider = service.createOAuthClientProvider(
      oauthServer("github", "https://mcp.example.com"),
    );

    expect(provider?.redirectUrl).toBe("http://localhost:34567/callback");
  });

  it("records the scope of an insufficient_scope challenge before requiring re-authentication", async () => {
    const mockFetch = jest.fn() as unknown as McpTransportFetch;
    const app = createMockApp();
    const service = new McpOAuthService(app.secretStorage, mockFetch, mockExternalOpener);
    const server = oauthServer("github", "https://mcp.example.com");
    await service.createOAuthClientProvider(server)!.saveTokens({
      access_token: "mcp-token",
      token_type: "Bearer",
      refresh_token: "refresh-token",
      scope: "repo:read",
    });
    const store = new McpSecretAuthStore(app.secretStorage);

    const authProvider = service.createAuthProvider(server)!;
    // pi-mcp's own handling needs the network; only the recording that precedes it is under test.
    await authProvider.onUnauthorized!({
      response: new Response(null, {
        status: 403,
        headers: { "www-authenticate": 'Bearer error="insufficient_scope", scope="repo:write"' },
      }),
      serverUrl: new URL("https://mcp.example.com"),
      fetch: jest.fn().mockRejectedValue(new Error("offline")),
      token: "mcp-token",
    }).catch(() => undefined);

    expect((await store.getEntry("github"))?.stepUpScope).toBe("repo:read repo:write");
  });

  it("does not record a step-up scope for an ordinary 401", async () => {
    const mockFetch = jest.fn() as unknown as McpTransportFetch;
    const app = createMockApp();
    const service = new McpOAuthService(app.secretStorage, mockFetch, mockExternalOpener);
    const server = oauthServer("github", "https://mcp.example.com");
    await service.createOAuthClientProvider(server)!.saveTokens({
      access_token: "mcp-token",
      token_type: "Bearer",
      scope: "repo:read",
    });

    await service.createAuthProvider(server)!.onUnauthorized!({
      response: new Response(null, { status: 401, headers: { "www-authenticate": 'Bearer scope="repo:write"' } }),
      serverUrl: new URL("https://mcp.example.com"),
      fetch: jest.fn().mockRejectedValue(new Error("offline")),
      token: "mcp-token",
    }).catch(() => undefined);

    const store = new McpSecretAuthStore(app.secretStorage);
    expect((await store.getEntry("github"))?.stepUpScope).toBeUndefined();
  });
});

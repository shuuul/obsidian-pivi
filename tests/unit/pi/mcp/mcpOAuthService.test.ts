import { App } from "obsidian";

import { ObsidianVaultFileAdapter } from "@pivi/obsidian-host";
import type { ManagedMcpServer } from "@pivi/pivi-agent-core/mcp/types";
import type { McpTransportFetch } from "@pivi/pivi-agent-core/mcp/ports";
import type { ExternalOpener } from "@pivi/pivi-agent-core/ports";
import { McpOAuthService } from "@pivi/pivi-agent-core/mcp/oauth/mcpOAuthService";
import { McpVaultAuthStore } from "@pivi/pivi-agent-core/mcp/oauth/mcpVaultAuthStore";

function createMemoryVaultAdapter(): ObsidianVaultFileAdapter {
  const app = new App();
  const files = new Map<string, string>();
  const folders = new Set<string>();

  app.vault.adapter.exists = jest.fn(
    async (path: string) => files.has(path) || folders.has(path),
  );
  app.vault.adapter.read = jest.fn(async (path: string) => {
    const value = files.get(path);
    if (value === undefined) {
      throw new Error(`missing: ${path}`);
    }
    return value;
  });
  app.vault.adapter.write = jest.fn(async (path: string, content: string) => {
    files.set(path, content);
  });
  app.vault.adapter.remove = jest.fn(async (path: string) => {
    files.delete(path);
  });
  app.vault.adapter.rmdir = jest.fn(async (path: string) => {
    folders.delete(path);
  });
  app.vault.adapter.mkdir = jest.fn(async (path: string) => {
    folders.add(path);
  });

  return new ObsidianVaultFileAdapter(app);
}

function oauthServer(name: string, url: string): ManagedMcpServer {
  return {
    name,
    config: { type: "http", url },
    enabled: true,
    contextSaving: true,
    auth: "oauth",
  };
}

function stdioServer(name = "local"): ManagedMcpServer {
  return {
    name,
    config: { type: "stdio", command: "echo" },
    enabled: true,
    contextSaving: true,
  };
}

const mockExternalOpener: ExternalOpener = {
  openExternalUrl: jest.fn().mockResolvedValue(undefined),
};

describe("McpOAuthService", () => {
  it("returns not_applicable for non-OAuth servers", async () => {
    const mockFetch = jest.fn() as unknown as McpTransportFetch;
    const service = new McpOAuthService(createMemoryVaultAdapter(), mockFetch, mockExternalOpener);
    const server = stdioServer();

    await expect(service.getAuthStatus(server)).resolves.toBe("not_applicable");
    await expect(service.authenticate(server)).resolves.toBe("not_applicable");
    expect(service.createAuthProvider(server)).toBeNull();
  });

  it("returns not_authenticated when OAuth server has no stored tokens", async () => {
    const mockFetch = jest.fn() as unknown as McpTransportFetch;
    const service = new McpOAuthService(createMemoryVaultAdapter(), mockFetch, mockExternalOpener);

    await expect(
      service.getAuthStatus(oauthServer("github", "https://mcp.example.com")),
    ).resolves.toBe("not_authenticated");
  });

  it("returns expired when stored OAuth tokens are past expiresAt", async () => {
    const mockFetch = jest.fn() as unknown as McpTransportFetch;
    const adapter = createMemoryVaultAdapter();
    const store = new McpVaultAuthStore(adapter);
    await store.updateTokens(
      "github",
      {
        accessToken: "expired-token",
        expiresAt: Math.floor(Date.now() / 1000) - 60,
      },
      "https://mcp.example.com",
    );
    const service = new McpOAuthService(adapter, mockFetch, mockExternalOpener);

    await expect(
      service.getAuthStatus(oauthServer("github", "https://mcp.example.com")),
    ).resolves.toBe("expired");
  });

  it("scopes MCP OAuth tokens by server URL through created auth providers", async () => {
    const mockFetch = jest.fn() as unknown as McpTransportFetch;
    const service = new McpOAuthService(createMemoryVaultAdapter(), mockFetch, mockExternalOpener);
    const originalProvider = service.createAuthProvider(
      oauthServer("github", "https://mcp.example.com"),
    );
    const movedProvider = service.createAuthProvider(
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
  });

  it("uses the injected callback port for auth provider redirect URLs", () => {
    const mockFetch = jest.fn() as unknown as McpTransportFetch;
    const service = new McpOAuthService(
      createMemoryVaultAdapter(),
      mockFetch,
      mockExternalOpener,
      { callbackPort: 34567 },
    );

    const provider = service.createAuthProvider(
      oauthServer("github", "https://mcp.example.com"),
    ) as { redirectUrl: string | undefined } | null;

    expect(provider?.redirectUrl).toBe("http://localhost:34567/callback");
  });
});
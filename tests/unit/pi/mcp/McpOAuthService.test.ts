import { App } from "obsidian";

import { ObsidianVaultFileAdapter } from "../../../../src/app/storage/ObsidianVaultFileAdapter";
import type { ManagedMcpServer } from "../../../../src/core/types";
import { McpOAuthService } from "../../../../src/pi/mcp/oauth/McpOAuthService";

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

describe("McpOAuthService", () => {
  it("returns not_applicable for non-OAuth servers", async () => {
    const service = new McpOAuthService(createMemoryVaultAdapter());
    const server: ManagedMcpServer = {
      name: "local",
      config: { type: "stdio", command: "echo" },
      enabled: true,
      contextSaving: true,
    };

    await expect(service.getAuthStatus(server)).resolves.toBe("not_applicable");
    expect(service.createAuthProvider(server)).toBeNull();
  });

  it("scopes MCP OAuth tokens by server URL through created auth providers", async () => {
    const service = new McpOAuthService(createMemoryVaultAdapter());
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
});

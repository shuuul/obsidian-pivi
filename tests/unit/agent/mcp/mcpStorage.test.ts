import { SecretStorage } from "obsidian";

import type { ManagedMcpServer } from "@pivi/agent/mcp/types";
import {
  McpConfigLoadError,
  McpStorage,
  PIVI_MCP_CONFIG_PATH,
  listMcpServerSecretIds,
} from "@pivi/agent/mcp/mcpStorage";
import { getMcpValueSecretId } from "@pivi/agent/mcp/mcpValueSources";
import type { FileStore } from "@pivi/agent/ports";

class MemoryVaultAdapter {
  private readonly files = new Map<string, string>();
  private readonly folders = new Set<string>();
  private readonly renameShouldFail: boolean;

  constructor(
    initialFiles: Record<string, string> = {},
    options: { renameShouldFail?: boolean } = {},
  ) {
    for (const [path, content] of Object.entries(initialFiles)) {
      this.files.set(path, content);
    }
    this.renameShouldFail = options.renameShouldFail ?? false;
  }

  async exists(path: string): Promise<boolean> {
    return this.files.has(path) || this.folders.has(path);
  }

  async read(path: string): Promise<string> {
    return this.files.get(path) ?? "";
  }

  async write(path: string, content: string): Promise<void> {
    this.files.set(path, content);
  }

  async delete(path: string): Promise<void> {
    this.files.delete(path);
  }

  async rename(oldPath: string, newPath: string): Promise<void> {
    if (this.renameShouldFail) {
      throw new Error("rename unavailable");
    }
    const content = this.files.get(oldPath);
    if (content === undefined) {
      throw new Error(`missing file: ${oldPath}`);
    }
    this.files.set(newPath, content);
    this.files.delete(oldPath);
  }

  async ensureFolder(path: string): Promise<void> {
    this.folders.add(path);
  }

  readSync(path: string): string {
    return this.files.get(path) ?? "";
  }

  listPaths(): string[] {
    return [...this.files.keys()];
  }
}

function remoteServer(
  overrides: Partial<ManagedMcpServer> = {},
): ManagedMcpServer {
  return {
    name: "remote",
    config: { type: "http", url: "https://mcp.example.com" },
    enabled: true,
    contextSaving: true,
    ...overrides,
  };
}

describe("McpStorage", () => {
  it("stores static MCP bearer tokens in SecretStorage instead of mcp.json", async () => {
    const adapter = new MemoryVaultAdapter();
    const secretStorage = new SecretStorage();
    const storage = new McpStorage(
      adapter as unknown as FileStore,
      secretStorage,
    );

    await storage.save([
      remoteServer({
        auth: "bearer",
        bearerToken: "bearer-secret",
      }),
    ]);

    const raw = adapter.readSync(PIVI_MCP_CONFIG_PATH);
    expect(raw).not.toContain("bearer-secret");
    expect(JSON.parse(raw)._pivi.servers.remote.bearerToken).toBeUndefined();

    const loaded = await storage.load();
    const [server] = loaded;
    expect(server).toBeDefined();
    if (!server) throw new Error('Expected the stored bearer-token server');
    expect(server.bearerToken).toBe("bearer-secret");
  });

  it("stores static OAuth client secrets in SecretStorage instead of mcp.json", async () => {
    const adapter = new MemoryVaultAdapter();
    const secretStorage = new SecretStorage();
    const storage = new McpStorage(
      adapter as unknown as FileStore,
      secretStorage,
    );

    await storage.save([
      remoteServer({
        auth: "oauth",
        oauth: {
          grantType: "client_credentials",
          clientId: "client-id",
          clientSecret: "client-secret",
        },
      }),
    ]);

    const raw = adapter.readSync(PIVI_MCP_CONFIG_PATH);
    expect(raw).toContain("client-id");
    expect(raw).not.toContain("client-secret");
    expect(
      JSON.parse(raw)._pivi.servers.remote.oauth.clientSecret,
    ).toBeUndefined();

    const loaded = await storage.load();
    const [server] = loaded;
    expect(server).toBeDefined();
    if (!server) throw new Error('Expected the stored OAuth server');
    expect(server.oauth).toMatchObject({
      clientId: "client-id",
      clientSecret: "client-secret",
    });
  });

  it("does not revive bearer and OAuth secrets after they are cleared", async () => {
    const adapter = new MemoryVaultAdapter();
    const secretStorage = new SecretStorage();
    const storage = new McpStorage(adapter as unknown as FileStore, secretStorage);

    await storage.save([
      remoteServer({ auth: "bearer", bearerToken: "bearer-secret" }),
      remoteServer({
        name: "oauth",
        auth: "oauth",
        oauth: {
          grantType: "client_credentials",
          clientId: "client-id",
          clientSecret: "client-secret",
        },
      }),
    ]);
    await storage.save([
      remoteServer({ auth: "bearer" }),
      remoteServer({
        name: "oauth",
        auth: "oauth",
        oauth: { grantType: "client_credentials", clientId: "client-id" },
      }),
    ]);

    const loaded = await storage.load();
    expect(loaded.find(server => server.name === "remote")?.bearerToken).toBeUndefined();
    expect(loaded.find(server => server.name === "oauth")?.oauth).not.toHaveProperty("clientSecret");
  });

  it("stores bearer tokens for long MCP server names using digest secret ids", async () => {
    const adapter = new MemoryVaultAdapter();
    const secretStorage = new SecretStorage();
    const storage = new McpStorage(
      adapter as unknown as FileStore,
      secretStorage,
    );
    const serverName = "my-very-long-mcp-server-name-example";

    await storage.save([
      remoteServer({
        name: serverName,
        auth: "bearer",
        bearerToken: "bearer-secret",
      }),
    ]);

    const secretIds = secretStorage.listSecrets().filter((id) => id.startsWith("pivi-mcp"));
    expect(secretIds).toHaveLength(1);
    expect(secretIds[0]).toMatch(/^pivi-mcp-d-[0-9a-f]{16}-bearer-token$/);
    expect(secretIds[0]!.length).toBeLessThanOrEqual(64);

    const loaded = await storage.load();
    expect(loaded[0]?.bearerToken).toBe("bearer-secret");
  });

  it("migrates legacy plaintext MCP secrets out of mcp.json on load", async () => {
    const adapter = new MemoryVaultAdapter({
      [PIVI_MCP_CONFIG_PATH]: `${JSON.stringify(
        {
          mcpServers: {
            remote: { type: "http", url: "https://mcp.example.com" },
          },
          _pivi: {
            servers: {
              remote: {
                auth: "oauth",
                oauth: {
                  clientId: "client-id",
                  clientSecret: "legacy-client-secret",
                },
                bearerToken: "legacy-bearer-secret",
              },
            },
          },
        },
        null,
        2,
      )}\n`,
    });
    const secretStorage = new SecretStorage();
    const storage = new McpStorage(
      adapter as unknown as FileStore,
      secretStorage,
    );

    const loaded = await storage.load();
    const [server] = loaded;
    expect(server).toBeDefined();
    if (!server) throw new Error('Expected the migrated OAuth server');

    expect(server.oauth).toMatchObject({
      clientSecret: "legacy-client-secret",
    });
    const raw = adapter.readSync(PIVI_MCP_CONFIG_PATH);
    expect(raw).not.toContain("legacy-client-secret");
    expect(raw).not.toContain("legacy-bearer-secret");
  });

  it("migrates secret-like headers and stdio env into SecretStorage on load", async () => {
    const adapter = new MemoryVaultAdapter({
      [PIVI_MCP_CONFIG_PATH]: `${JSON.stringify(
        {
          mcpServers: {
            remote: {
              type: "http",
              url: "https://mcp.example.com",
              headers: {
                Authorization: "Bearer legacy-token",
                "X-Custom": "plain-value",
              },
            },
            local: {
              command: "node",
              env: {
                PLAIN_VAR: "visible",
                API_KEY: "secret-env",
              },
            },
          },
        },
        null,
        2,
      )}\n`,
    });
    const secretStorage = new SecretStorage();
    const storage = new McpStorage(
      adapter as unknown as FileStore,
      secretStorage,
    );

    const loaded = await storage.load();
    const remote = loaded.find((server) => server.name === "remote");
    const local = loaded.find((server) => server.name === "local");
    expect(remote?.config).toMatchObject({
      headers: {
        Authorization: { kind: "secret" },
        "X-Custom": { kind: "plain", value: "plain-value" },
      },
    });
    expect(local?.config).toMatchObject({
      env: {
        PLAIN_VAR: { kind: "plain", value: "visible" },
        API_KEY: { kind: "secret" },
      },
    });

    const raw = adapter.readSync(PIVI_MCP_CONFIG_PATH);
    expect(raw).not.toContain("legacy-token");
    expect(raw).not.toContain("secret-env");
    expect(secretStorage.getSecret(getMcpValueSecretId("remote", "header", "Authorization")))
      .toBe("Bearer legacy-token");
    expect(secretStorage.getSecret(getMcpValueSecretId("local", "env", "API_KEY")))
      .toBe("secret-env");
  });

  it("preserves corrupt JSON and throws a typed load error", async () => {
    const corrupt = "{ not-json";
    const adapter = new MemoryVaultAdapter({
      [PIVI_MCP_CONFIG_PATH]: corrupt,
    });
    const storage = new McpStorage(adapter as unknown as FileStore, new SecretStorage());

    await expect(storage.load()).rejects.toBeInstanceOf(McpConfigLoadError);
    expect(adapter.readSync(PIVI_MCP_CONFIG_PATH)).toBe(corrupt);
    expect(adapter.listPaths().some((path) => path.includes(".corrupt-"))).toBe(true);
  });

  it("does not delete obsolete secrets when config publication fails", async () => {
    const adapter = new MemoryVaultAdapter({
      [PIVI_MCP_CONFIG_PATH]: `${JSON.stringify(
        {
          mcpServers: {
            remote: {
              type: "http",
              url: "https://mcp.example.com",
              headers: { Authorization: { kind: "secret" } },
            },
          },
        },
        null,
        2,
      )}\n`,
    }, { renameShouldFail: true });
    const secretStorage = new SecretStorage();
    secretStorage.setSecret(
      getMcpValueSecretId("remote", "header", "Authorization"),
      "stored-token",
    );
    const storage = new McpStorage(adapter as unknown as FileStore, secretStorage);

    await storage.load();

    const failingAdapter = Object.assign(adapter, {
      write: jest.fn(async () => {
        throw new Error("disk full");
      }),
    }) as unknown as FileStore;

    const failingStorage = new McpStorage(failingAdapter, secretStorage);
    await expect(failingStorage.save([])).rejects.toThrow("disk full");
    expect(secretStorage.getSecret(getMcpValueSecretId("remote", "header", "Authorization")))
      .toBe("stored-token");
  });

  it("keeps whitespace-cleared credentials when config publication fails", async () => {
    const adapter = new MemoryVaultAdapter();
    const secretStorage = new SecretStorage();
    const storage = new McpStorage(adapter as unknown as FileStore, secretStorage);
    await storage.save([
      remoteServer({ auth: "bearer", bearerToken: "bearer-secret" }),
      remoteServer({
        name: "oauth",
        auth: "oauth",
        oauth: {
          grantType: "client_credentials",
          clientId: "client-id",
          clientSecret: "client-secret",
        },
      }),
    ]);
    const failingAdapter = Object.assign(adapter, {
      write: jest.fn(async () => { throw new Error("disk full"); }),
    }) as unknown as FileStore;
    const failingStorage = new McpStorage(failingAdapter, secretStorage);

    await expect(failingStorage.save([
      remoteServer({ auth: "bearer", bearerToken: "   " }),
      remoteServer({
        name: "oauth",
        auth: "oauth",
        oauth: {
          grantType: "client_credentials",
          clientId: "client-id",
          clientSecret: "   ",
        },
      }),
    ])).rejects.toThrow("disk full");

    const loaded = await failingStorage.load();
    expect(loaded.find(server => server.name === "remote")?.bearerToken).toBe("bearer-secret");
    expect(loaded.find(server => server.name === "oauth")?.oauth).toMatchObject({
      clientSecret: "client-secret",
    });
  });

  it("isolates staged-secret rollback failures and preserves the publication error", async () => {
    const adapter = new MemoryVaultAdapter();
    const values = new Map<string, string>();
    let failRollbackId: string | undefined;
    const secretStorage = {
      getSecret: (id: string) => values.get(id) ?? null,
      setSecret: (id: string, value: string) => { values.set(id, value); },
      deleteSecret: (id: string) => {
        if (id === failRollbackId) throw new Error("keychain rollback unavailable");
        values.delete(id);
      },
      listSecrets: (prefix?: string) => [...values.keys()].filter(id => !prefix || id.startsWith(prefix)),
    };
    const failingAdapter = Object.assign(adapter, {
      write: jest.fn(async () => { throw new Error("disk full"); }),
    }) as unknown as FileStore;
    const storage = new McpStorage(failingAdapter, secretStorage);
    const goodId = listMcpServerSecretIds("good", "bearer-token")[0]!;
    const badId = listMcpServerSecretIds("bad", "bearer-token")[0]!;
    failRollbackId = badId;

    await expect(storage.save([
      remoteServer({ name: "good", auth: "bearer", bearerToken: "good-token" }),
      remoteServer({ name: "bad", auth: "bearer", bearerToken: "bad-token" }),
    ])).rejects.toThrow("disk full");

    expect(values.get(goodId)).toBeUndefined();
    expect(values.get(badId)).toBe("bad-token");
  });

  it.each([
    {
      label: "remote headers to stdio env",
      initial: remoteServer({
        config: {
          type: "http",
          url: "https://mcp.example.com",
          headers: { Authorization: { kind: "secret" } },
        },
      }),
      next: remoteServer({
        config: { command: "node", env: { API_KEY: { kind: "secret" } } },
      }),
      oldId: getMcpValueSecretId("remote", "header", "Authorization"),
      oldValue: "old-header",
      nextId: getMcpValueSecretId("remote", "env", "API_KEY"),
    },
    {
      label: "stdio env to remote headers",
      initial: remoteServer({
        config: { command: "node", env: { API_KEY: { kind: "secret" } } },
      }),
      next: remoteServer({
        config: {
          type: "http",
          url: "https://mcp.example.com",
          headers: { Authorization: { kind: "secret" } },
        },
      }),
      oldId: getMcpValueSecretId("remote", "env", "API_KEY"),
      oldValue: "old-env",
      nextId: getMcpValueSecretId("remote", "header", "Authorization"),
    },
  ])("cleans every old channel secret after publishing $label", async ({ initial, next, oldId, oldValue, nextId }) => {
    const adapter = new MemoryVaultAdapter();
    const secretStorage = new SecretStorage();
    const storage = new McpStorage(adapter as unknown as FileStore, secretStorage);
    secretStorage.setSecret(oldId, oldValue);
    await storage.save([initial]);
    secretStorage.setSecret(nextId, "new-secret");

    await storage.save([next]);

    expect(secretStorage.getSecret(oldId)).toBeNull();
  });

  it("preserves a concurrent OAuth secret write when config publication fails", async () => {
    const adapter = new MemoryVaultAdapter();
    const secretStorage = new SecretStorage();
    const secretId = listMcpServerSecretIds("remote", "bearer-token")[0]!;
    secretStorage.setSecret(secretId, "previous-token");
    const failingAdapter = Object.assign(adapter, {
      write: jest.fn(async () => {
        // Simulate an OAuth callback updating the same key after this save staged it.
        secretStorage.setSecret(secretId, "concurrent-oauth-token");
        throw new Error("disk full");
      }),
    }) as unknown as FileStore;
    const storage = new McpStorage(failingAdapter, secretStorage);

    await expect(storage.save([
      remoteServer({ auth: "bearer", bearerToken: "transaction-token" }),
    ])).rejects.toThrow("disk full");

    expect(secretStorage.getSecret(secretId)).toBe("concurrent-oauth-token");
  });

  it("keeps staged secrets when a post-publication config read fails", async () => {
    const adapter = new MemoryVaultAdapter();
    const secretStorage = new SecretStorage();
    const secretId = listMcpServerSecretIds("remote", "bearer-token")[0]!;
    const baseRead = adapter.read.bind(adapter);
    const baseRename = adapter.rename.bind(adapter);
    adapter.rename = async (oldPath, newPath) => {
      await baseRename(oldPath, newPath);
      if (newPath === PIVI_MCP_CONFIG_PATH) {
        // After durable mcp.json lands, any async re-read of the config fails.
        adapter.read = async (path) => {
          if (path === PIVI_MCP_CONFIG_PATH) {
            throw new Error("post-publish read failed");
          }
          return baseRead(path);
        };
      }
    };
    const storage = new McpStorage(adapter as unknown as FileStore, secretStorage);

    await expect(storage.save([
      remoteServer({ auth: "bearer", bearerToken: "bearer-secret" }),
    ])).resolves.toBeUndefined();

    expect(secretStorage.getSecret(secretId)).toBe("bearer-secret");
    const raw = adapter.readSync(PIVI_MCP_CONFIG_PATH);
    expect(raw.length).toBeGreaterThan(0);
    expect(raw).not.toContain("bearer-secret");
  });

  it("returns the CAS revision from exact published bytes", async () => {
    const adapter = new MemoryVaultAdapter();
    const secretStorage = new SecretStorage();
    const storage = new McpStorage(adapter as unknown as FileStore, secretStorage);
    const before = await storage.loadRevisionedSnapshot();

    const saved = await storage.saveIfRevision([
      remoteServer({ auth: "bearer", bearerToken: "bearer-secret" }),
    ], before.revision);

    const published = adapter.readSync(PIVI_MCP_CONFIG_PATH);
    expect(published).not.toContain("bearer-secret");
    // Re-open with a clean storage so revision is derived only from on-disk bytes.
    const verifier = new McpStorage(adapter as unknown as FileStore, secretStorage);
    const after = await verifier.loadRevisionedSnapshot();
    expect(saved.revision).toBe(after.revision);
    expect(saved.revision).not.toBe(before.revision);
  });

  it("serializes concurrent saves", async () => {
    const adapter = new MemoryVaultAdapter();
    const secretStorage = new SecretStorage();
    const storage = new McpStorage(adapter as unknown as FileStore, secretStorage);
    const order: string[] = [];

    const first = storage.save([
      remoteServer({
        name: "first",
        config: { type: "http", url: "https://first.example.com" },
      }),
    ]).then(() => {
      order.push("first");
    });
    const second = storage.save([
      remoteServer({
        name: "second",
        config: { type: "http", url: "https://second.example.com" },
      }),
    ]).then(() => {
      order.push("second");
    });

    await Promise.all([first, second]);
    expect(order).toEqual(["first", "second"]);
    const loaded = await storage.load();
    expect(loaded).toHaveLength(1);
    expect(["first", "second"]).toContain(loaded[0]?.name);
  });

  it("does not rewrite mcp.json on a second load after migration", async () => {
    const adapter = new MemoryVaultAdapter({
      [PIVI_MCP_CONFIG_PATH]: `${JSON.stringify(
        {
          mcpServers: {
            remote: {
              type: "http",
              url: "https://mcp.example.com",
              headers: { Authorization: "Bearer legacy-token" },
            },
          },
        },
        null,
        2,
      )}\n`,
    });
    const secretStorage = new SecretStorage();
    const storage = new McpStorage(adapter as unknown as FileStore, secretStorage);

    await storage.load();
    const afterFirst = adapter.readSync(PIVI_MCP_CONFIG_PATH);
    await storage.load();
    const afterSecond = adapter.readSync(PIVI_MCP_CONFIG_PATH);
    expect(afterSecond).toBe(afterFirst);
  });
});

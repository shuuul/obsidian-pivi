import { McpVaultAuthStore } from '@pivi/pivi-agent-core/mcp/oauth/mcpVaultAuthStore';

class MemoryVaultAdapter {
  private readonly files = new Map<string, string>();

  async exists(path: string): Promise<boolean> {
    return this.files.has(path);
  }

  async read(path: string): Promise<string> {
    const value = this.files.get(path);
    if (value === undefined) {
      throw new Error(`missing: ${path}`);
    }
    return value;
  }

  async write(path: string, content: string): Promise<void> {
    this.files.set(path, content);
  }

  async delete(path: string): Promise<void> {
    this.files.delete(path);
  }

  async deleteFolder(): Promise<void> {
    // no-op for memory adapter
  }

  async ensureFolder(): Promise<void> {
    // no-op
  }
}

describe('McpVaultAuthStore', () => {
  it('stores and reads tokens scoped to server URL', async () => {
    const adapter = new MemoryVaultAdapter();
    const store = new McpVaultAuthStore(adapter as never);

    await store.updateTokens('github', {
      accessToken: 'token-a',
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
    }, 'https://mcp.example.com');

    const entry = await store.getAuthForUrl('github', 'https://mcp.example.com');
    expect(entry?.tokens?.accessToken).toBe('token-a');

    const wrongUrl = await store.getAuthForUrl('github', 'https://other.example.com');
    expect(wrongUrl).toBeUndefined();

    const persisted = await store.getEntry('github');
    expect(persisted?.serverUrl).toBe('https://mcp.example.com');
  });
});

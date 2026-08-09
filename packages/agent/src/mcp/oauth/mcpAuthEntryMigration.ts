import type { FileStore, SyncSecretStore } from '../../ports';
import { PIVI_MCP_OAUTH_DIR } from '../paths';
import { McpSecretAuthStore } from './mcpSecretAuthStore';
import type { AuthEntry } from './mcpVaultAuthStore';
import { McpVaultAuthStore } from './mcpVaultAuthStore';

export class McpAuthEntryMigrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'McpAuthEntryMigrationError';
  }
}

function entryHasPayload(entry: AuthEntry | undefined): entry is AuthEntry {
  if (!entry) {
    return false;
  }
  return !!(
    entry.tokens
    || entry.clientInfo
    || entry.codeVerifier
    || entry.oauthState
    || entry.serverUrl
  );
}

/**
 * Migrate vault-local MCP OAuth entries into SecretStorage, then remove plaintext
 * vault files only after every required write succeeds.
 */
export async function migrateMcpAuthEntriesToSecretStorage(
  vaultAdapter: FileStore,
  secretStorage: SyncSecretStore,
  serverNames: readonly string[],
): Promise<{ migratedServerNames: string[] }> {
  const vaultStore = new McpVaultAuthStore(vaultAdapter);
  const secretStore = new McpSecretAuthStore(secretStorage);
  const migratedServerNames: string[] = [];

  for (const serverName of serverNames) {
    const entry = await vaultStore.getEntry(serverName);
    if (!entryHasPayload(entry)) {
      continue;
    }
    try {
      await secretStore.saveEntry(serverName, entry, entry.serverUrl);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new McpAuthEntryMigrationError(
        `Failed to migrate MCP OAuth auth entry for "${serverName}": ${message}`,
      );
    }
    migratedServerNames.push(serverName);
  }

  // Always remove plaintext vault OAuth dirs after attempting known-server
  // migration, including orphan folders that cannot be mapped back to a name.
  await cleanupVaultMcpOAuthDirectory(vaultAdapter);
  return { migratedServerNames };
}

async function cleanupVaultMcpOAuthDirectory(adapter: FileStore): Promise<void> {
  if (!(await adapter.exists(PIVI_MCP_OAUTH_DIR))) {
    return;
  }

  const folders = await adapter.listFolders(PIVI_MCP_OAUTH_DIR);
  for (const folder of folders) {
    const dirPath = `${PIVI_MCP_OAUTH_DIR}/${folder}`;
    const tokenPath = `${dirPath}/tokens.json`;
    if (await adapter.exists(tokenPath)) {
      await adapter.delete(tokenPath);
    }
    await adapter.deleteFolder(dirPath);
  }
}

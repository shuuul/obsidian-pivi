import type { ManagedMcpServer, McpAuthStatus } from './types';

export interface FileStore {
  exists(path: string): Promise<boolean>;
  read(path: string): Promise<string>;
  write(path: string, content: string): Promise<void>;
  append(path: string, content: string): Promise<void>;
  delete(path: string): Promise<void>;
  deleteFolder(path: string): Promise<void>;
  listFiles(path: string): Promise<string[]>;
  listFolders(path: string): Promise<string[]>;
  listFilesRecursive(path: string): Promise<string[]>;
  ensureFolder(path: string): Promise<void>;
  rename(oldPath: string, newPath: string): Promise<void>;
  stat(path: string): Promise<{ mtime: number; size: number } | null>;
}

export interface SecretStorageLike {
  getSecret(key: string): string | null;
  setSecret(key: string, value: string): void;
  listSecrets(): string[];
}

export interface PreparedMcpTurn {
  mcpMentions: Set<string>;
  request: Record<string, unknown> & {
    enabledMcpServers?: Set<string>;
  };
}

export interface AppMcpOAuth {
  getAuthStatus(server: ManagedMcpServer): Promise<McpAuthStatus>;
  authenticate(server: ManagedMcpServer): Promise<McpAuthStatus>;
  logout(serverName: string): Promise<void>;
}

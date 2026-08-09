import type { ObsidianToolsSettings } from '@pivi/pivi-agent-core/foundation';
import type { ReadAllowanceReservation } from '@pivi/pivi-agent-core/foundation/usage';

/** Structural vault surface shared by desktop and the isolated Mobile leaf. */
export interface VaultToolApi {
  readNote(file?: string, path?: string): Promise<{ path: string; content: string }>;
  editNote(params: { file?: string; path?: string; old_string: string; new_string: string; replace_all?: boolean }): Promise<{ path: string; replacements: number }>;
  writeNote(params: { file?: string; path?: string; content: string; mode: 'create' | 'overwrite' | 'append' | 'prepend'; overwrite?: boolean }): Promise<{ path: string }>;
  searchNotes(params: { query: string; path?: string; limit?: number; context?: boolean }): Promise<Array<{ path: string; line?: number; matches?: string[] }>>;
  listPath(path?: string): Array<{
    path: string;
    kind: 'file' | 'folder';
    name: string;
    extension?: string;
    size?: number;
  }>;
  getNoteInfo(file?: string, path?: string): Promise<unknown>;
  getRecentFiles(limit?: number): unknown[];
  getLinks(file?: string, path?: string, direction?: 'outgoing' | 'backlinks'): unknown;
  getProperties(file?: string, path?: string, name?: string): unknown;
  setProperty(file: string | undefined, path: string | undefined, name: string, value: string): Promise<{ path: string; name: string }>;
  removeProperty(file: string | undefined, path: string | undefined, name: string): Promise<{ path: string; name: string }>;
  getTags(sort?: 'name' | 'count'): Array<{ name: string; count: number }>;
  getTagInfo(tag: string, verbose?: boolean): { name: string; count: number; files?: string[] };
  getGraphAnalysis(actions: Array<'orphans' | 'deadends' | 'unresolved'>, options?: { includeNonMarkdown?: boolean; limit?: number }): { orphans: string[]; deadends: string[]; unresolved: Array<{ source: string; target: string; count: number }> };
  movePath(params: { path: string; newPath: string }): Promise<{ path: string; newPath: string }>;
  trashPath(params: { file?: string; path?: string }): Promise<{ path: string; kind: 'file' | 'folder' }>;
  createFolder(path: string): Promise<{ path: string }>;
  getAttachmentInfo(params: { path?: string; filename?: string; sourcePath?: string }): Promise<{
    path?: string;
    availablePath?: string;
    markdown?: string;
    resourcePath?: string;
    size?: number;
    extension?: string;
  }>;
}

export interface VaultToolDeps {
  vault: VaultToolApi;
  settings: ObsidianToolsSettings;
  obsidianCliAvailable?: boolean;
  /** Unreachable compatibility seam for factories whose desktop branch supports CLI fallback. */
  cli: { run(request: { vaultName: string; args: string[] }): Promise<string> };
  vaultName: string;
  resolveReadMaxChars?: (requestedMaxChars?: number) => ReadAllowanceReservation;
}

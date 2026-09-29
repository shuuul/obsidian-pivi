/** Result shapes returned by `ObsidianVaultApi` to Obsidian-backed tools. */
export interface VaultSearchHit {
  path: string;
  line?: number;
  matches?: string[];
}

export interface VaultNoteInfo {
  path: string;
  basename: string;
  extension: string;
  size: number;
  ctime: number;
  mtime: number;
  tags: string[];
  links: string[];
  frontmatter: Record<string, unknown> | null;
  wordCount: number;
  characterCount: number;
  aliases: string[];
}

export interface VaultTagEntry {
  name: string;
  count: number;
}

export interface VaultPropertyIndexEntry {
  name: string;
  count: number;
}

export interface VaultAliasEntry {
  alias: string;
  count: number;
  files?: string[];
}

export interface VaultGraphResult {
  orphans: string[];
  deadends: string[];
  unresolved: { source: string; target: string; count: number }[];
}

export interface VaultRecentFile {
  path: string;
  basename: string;
  mtime: number | null;
}

export interface VaultBaseFile {
  path: string;
  basename: string;
  size: number;
  mtime: number;
}

export interface VaultBaseView {
  name: string;
  type: string;
  columns: string[];
}

export interface VaultLinkEntry {
  path: string;
  count: number;
  display?: string;
}

export interface VaultDeleteResult {
  path: string;
  kind: 'file' | 'folder';
}

export interface VaultPathEntry {
  path: string;
  kind: 'file' | 'folder';
  name: string;
  extension?: string;
  size?: number;
}

export interface VaultAttachmentInfo {
  path?: string;
  availablePath?: string;
  markdown?: string;
  resourcePath?: string;
  size?: number;
  extension?: string;
}

export interface VaultWriteAttachmentResult {
  path: string;
  markdown: string;
  resourcePath: string;
  size: number;
  extension: string;
}

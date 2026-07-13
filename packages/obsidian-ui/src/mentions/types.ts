import type { InlineContextReference } from '@pivi/pivi-agent-core/context/inlineContext';

export interface ExternalContextDisplayEntry {
  contextRoot: string;
  displayName: string;
  displayNameLower: string;
}

export type MentionBadgeKind = 'plain' | 'file' | 'folder' | 'mcp' | 'skill' | 'agent' | 'inline-context';

export interface PlainMentionPart {
  kind: 'plain';
  text: string;
}

export interface FileMentionPart {
  kind: 'file';
  raw: string;
  path: string;
  label: string;
}

export interface FolderMentionPart {
  kind: 'folder';
  raw: string;
  path: string;
  label: string;
}

export interface McpMentionPart {
  kind: 'mcp';
  raw: string;
  serverName: string;
  toolName?: string;
}

export interface SkillMentionPart {
  kind: 'skill';
  raw: string;
  commandName: string;
}

export interface AgentMentionPart {
  kind: 'agent';
  raw: string;
  agentId: string;
  label: string;
}

export interface InlineContextMentionPart {
  kind: 'inline-context';
  raw: string;
  context: InlineContextReference;
  label: string;
}

export type MentionBadgePart =
  | PlainMentionPart
  | FileMentionPart
  | FolderMentionPart
  | McpMentionPart
  | SkillMentionPart
  | AgentMentionPart
  | InlineContextMentionPart;

/** Vault file entry used by mention parsing (no Obsidian App). */
export interface MentionVaultFile {
  path: string;
  basename: string;
}

/** Vault folder entry used by mention parsing (no Obsidian App). */
export interface MentionVaultFolder {
  path: string;
  name: string;
}

export type MentionVaultEntry =
  | ({ kind: 'file' } & MentionVaultFile)
  | ({ kind: 'folder' } & MentionVaultFolder);

/**
 * Narrow vault surface for badge/mention parsing. App adapters live in product UI;
 * the package must not require Obsidian `App` on parse context.
 */
export interface MentionVaultLookup {
  getFiles(): readonly MentionVaultFile[];
  getFolders(): readonly MentionVaultFolder[];
  getByPath(path: string): MentionVaultEntry | null;
  resolveWikilink(linkPath: string, sourcePath?: string): MentionVaultEntry | null;
}

export interface MentionBadgeParseContext {
  vault: MentionVaultLookup;
  mcpServerNames: Set<string>;
  skillCommandNames?: Set<string>;
  externalContextEntries?: ExternalContextDisplayEntry[];
}

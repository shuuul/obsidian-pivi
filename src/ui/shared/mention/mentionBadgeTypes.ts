import type { InlineContextReference } from '@pivi/pivi-agent-core/context/inlineContext';
import type { App } from 'obsidian';

import type { ExternalContextDisplayEntry } from '../utils/externalContext';

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

export interface MentionBadgeParseContext {
  app: App;
  mcpServerNames: Set<string>;
  skillCommandNames?: Set<string>;
  externalContextEntries?: ExternalContextDisplayEntry[];
  getExternalContextLookup?: (contextRoot: string) => Map<string, string>;
}

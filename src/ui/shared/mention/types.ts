import type { TFile } from 'obsidian';

export type AgentMentionSource = 'builtin' | 'vault' | 'user' | 'runtime' | 'plugin';

export interface AgentMentionProvider {
  searchAgents(query: string): Array<{
    id: string;
    name: string;
    description?: string;
    source: AgentMentionSource;
  }>;
}

export interface FileMentionItem {
  type: 'file';
  name: string;
  path: string;
  file: TFile;
}

export interface FolderMentionItem {
  type: 'folder';
  name: string;
  path: string;
}

export interface ContextFileMentionItem {
  type: 'context-file';
  name: string;
  absolutePath: string;
  contextRoot: string;
  folderName: string;
}

export interface ContextFolderMentionItem {
  type: 'context-folder';
  name: string;
  contextRoot: string;
  folderName: string;
}

export interface AgentMentionItem {
  type: 'agent';
  /** Display name */
  name: string;
  /** Full ID (namespaced for plugins) */
  id: string;
  /** Brief description */
  description?: string;
  /** Source of the agent */
  source: AgentMentionSource;
}

export interface AgentFolderMentionItem {
  type: 'agent-folder';
  name: string;
}

export type MentionItem =
  | FileMentionItem
  | FolderMentionItem
  | ContextFileMentionItem
  | ContextFolderMentionItem
  | AgentMentionItem
  | AgentFolderMentionItem;

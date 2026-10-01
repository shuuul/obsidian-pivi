import type { TFile } from 'obsidian';

export interface FileMentionItem {
  type: 'file';
  name: string;
  path: string;
  file: TFile;
  aliases?: string[];
  matchedAlias?: string;
}

export interface FolderMentionItem {
  type: 'folder';
  name: string;
  path: string;
}

export interface ContextFolderMentionItem {
  type: 'context-folder';
  name: string;
  contextRoot: string;
  folderName: string;
}

export interface SelectedTextTemplateMentionItem {
  type: 'selected-text-template';
  name: string;
}

export interface SessionMentionItem {
  type: 'session';
  id: string;
  name: string;
  preview: string;
  sessionFile: string;
}

export type MentionItem =
  | FileMentionItem
  | FolderMentionItem
  | ContextFolderMentionItem
  | SessionMentionItem
  | SelectedTextTemplateMentionItem;

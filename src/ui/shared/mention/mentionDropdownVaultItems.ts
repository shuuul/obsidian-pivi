import type { TFile } from 'obsidian';

import {
  findMatchedAlias,
  normalizeAliases,
} from './mentionTokenHelpers';
import type { FileMentionItem, FolderMentionItem } from './types';

export interface VaultMentionBuildOptions {
  searchLower: string;
  files: TFile[];
  folders: Array<Pick<FolderMentionItem, 'name' | 'path'>>;
  getVaultFileAliases?: (file: TFile) => readonly string[];
  activeFilePath?: string | null;
}

type VaultMentionItem = FileMentionItem | FolderMentionItem;

type ScoredFolderItem = {
  type: 'folder';
  name: string;
  path: string;
  exactPathMatch: boolean;
  startsWithQuery: boolean;
  mtime: number;
  isActiveFile: false;
};

type ScoredFileItem = {
  type: 'file';
  name: string;
  path: string;
  file: TFile;
  aliases: string[];
  matchedAlias: string | undefined;
  exactPathMatch: boolean;
  startsWithQuery: boolean;
  mtime: number;
  isActiveFile: boolean;
};

type ScoredItem = ScoredFolderItem | ScoredFileItem;

function compareMentionItems(searchLower: string): (a: ScoredItem, b: ScoredItem) => number {
  return (a, b) => {
    if (!searchLower && a.isActiveFile !== b.isActiveFile) return a.isActiveFile ? -1 : 1;
    // An item whose path is exactly the query (e.g. typing "wiki/ai" to hit the
    // wiki/ai folder) outranks items that merely start with or contain the query.
    if (a.exactPathMatch !== b.exactPathMatch) return a.exactPathMatch ? -1 : 1;
    if (a.startsWithQuery !== b.startsWithQuery) return a.startsWithQuery ? -1 : 1;
    if (a.mtime !== b.mtime) return b.mtime - a.mtime;
    if (a.type !== b.type) return a.type === 'file' ? -1 : 1;
    return a.path.localeCompare(b.path);
  };
}

function buildFolderMtimeMap(files: TFile[]): Map<string, number> {
  const folderMtimeMap = new Map<string, number>();
  for (const f of files) {
    const parts = f.path.split('/');
    for (let i = 1; i < parts.length; i++) {
      const folderPath = parts.slice(0, i).join('/');
      const existing = folderMtimeMap.get(folderPath) ?? 0;
      if (f.stat.mtime > existing) {
        folderMtimeMap.set(folderPath, f.stat.mtime);
      }
    }
  }
  return folderMtimeMap;
}

function scoreFile(
  file: TFile,
  searchLower: string,
  aliases: string[],
  matchedAlias: string | undefined,
  activeFilePath: string | null | undefined,
): ScoredFileItem {
  const pathLower = file.path.toLowerCase();
  const nameLower = file.name.toLowerCase();
  const aliasLowers = aliases.map(alias => alias.toLowerCase());
  return {
    type: 'file',
    name: file.name,
    path: file.path,
    file,
    aliases,
    matchedAlias,
    exactPathMatch: pathLower === searchLower && searchLower.length > 0,
    startsWithQuery:
      nameLower.startsWith(searchLower) ||
      pathLower.startsWith(searchLower) ||
      aliasLowers.some(alias => alias.startsWith(searchLower)),
    mtime: file.stat.mtime,
    isActiveFile: activeFilePath === file.path,
  };
}

function hydrateFileAliases(
  item: ScoredFileItem,
  getVaultFileAliases: ((file: TFile) => readonly string[]) | undefined,
  activeFilePath: string | null | undefined,
): ScoredFileItem {
  const aliases = normalizeAliases(getVaultFileAliases?.(item.file));
  return scoreFile(item.file, '', aliases, undefined, activeFilePath);
}

function buildScoredFiles({
  searchLower,
  files,
  getVaultFileAliases,
  activeFilePath,
}: Omit<VaultMentionBuildOptions, 'folders'>): ScoredFileItem[] {
  const compare = compareMentionItems(searchLower);

  if (!searchLower) {
    return files
      .map(file => scoreFile(file, searchLower, [], undefined, activeFilePath))
      .sort(compare)
      .slice(0, 100)
      .map(item => hydrateFileAliases(item, getVaultFileAliases, activeFilePath));
  }

  return files
    .map((file): ScoredFileItem | null => {
      const aliases = normalizeAliases(getVaultFileAliases?.(file));
      const pathLower = file.path.toLowerCase();
      const nameLower = file.name.toLowerCase();
      const matchedAlias = findMatchedAlias(aliases, searchLower);
      const matchesQuery =
        pathLower.includes(searchLower) ||
        nameLower.includes(searchLower) ||
        matchedAlias !== undefined;
      if (!matchesQuery) return null;

      return scoreFile(file, searchLower, aliases, matchedAlias, activeFilePath);
    })
    .filter((item): item is ScoredFileItem => item !== null)
    .sort(compare)
    .slice(0, 100);
}

export function buildVaultMentionItems(options: VaultMentionBuildOptions): VaultMentionItem[] {
  const { searchLower, files, folders } = options;
  const compare = compareMentionItems(searchLower);
  const folderMtimeMap = buildFolderMtimeMap(files);

  const scoredFolders: ScoredFolderItem[] = folders
    .map(f => ({
      name: f.name,
      path: f.path.replace(/\\/g, '/').replace(/\/+$/, ''),
    }))
    .filter(f =>
      f.path.length > 0 &&
      (f.path.toLowerCase().includes(searchLower) || f.name.toLowerCase().includes(searchLower))
    )
    .map((f): ScoredFolderItem => {
      const pathLower = f.path.toLowerCase();
      return {
        type: 'folder' as const,
        name: f.name,
        path: f.path,
        exactPathMatch: pathLower === searchLower && searchLower.length > 0,
        startsWithQuery:
          f.name.toLowerCase().startsWith(searchLower) ||
          pathLower.startsWith(searchLower),
        mtime: folderMtimeMap.get(f.path) ?? 0,
        isActiveFile: false,
      };
    })
    .sort(compare)
    .slice(0, 50);

  const scoredFiles = buildScoredFiles(options);
  return [...scoredFolders, ...scoredFiles]
    .sort(compare)
    .map((item): VaultMentionItem => {
      if (item.type === 'folder') {
        return { type: 'folder', name: item.name, path: item.path };
      }
      return {
        type: 'file',
        name: item.name,
        path: item.path,
        file: item.file,
        aliases: item.aliases,
        matchedAlias: item.matchedAlias,
      };
    });
}

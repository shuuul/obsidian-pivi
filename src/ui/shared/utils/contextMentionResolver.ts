import type { App } from 'obsidian';
import { parseFrontMatterAliases, TFile, TFolder } from 'obsidian';

import type { ExternalContextDisplayEntry } from './externalContext';
import type { ExternalContextFile } from './externalContextScanner';

export interface MentionLookupMatch {
  resolvedPath: string;
  endIndex: number;
  trailingPunctuation: string;
}

export interface WikilinkMentionMatch {
  raw: string;
  linkPath: string;
  alias?: string;
  endIndex: number;
}

const TRAILING_PUNCTUATION_REGEX = /[),.!?:;]+$/;
const BOUNDARY_PUNCTUATION = new Set([',', ')', '!', '?', ':', ';']);

function isWhitespace(char: string): boolean {
  return /\s/.test(char);
}

function collectMentionEndCandidates(text: string, pathStart: number): number[] {
  const candidates = new Set<number>();

  for (let index = pathStart; index < text.length; index++) {
    const char = text[index];
    if (isWhitespace(char)) {
      candidates.add(index);
      continue;
    }

    if (BOUNDARY_PUNCTUATION.has(char)) {
      candidates.add(index + 1);
    }
  }

  candidates.add(text.length);
  return Array.from(candidates).sort((a, b) => b - a);
}

export function isMentionStart(text: string, index: number): boolean {
  if (text[index] !== '@') return false;
  if (index === 0) return true;
  return isWhitespace(text[index - 1]);
}

export function normalizeMentionPath(pathText: string): string {
  return pathText
    .replace(/\\/g, '/')
    .replace(/^\.?\//, '')
    .replace(/\/+/g, '/')
    .replace(/\/+$/, '');
}

export function normalizeForPlatformLookup(value: string): string {
  return process.platform === 'win32' ? value.toLowerCase() : value;
}

export function parseWikilinkMentionAtIndex(text: string, mentionStart: number): WikilinkMentionMatch | null {
  if (!text.startsWith('@[[', mentionStart)) return null;

  const linkStart = mentionStart + 3;
  const closeIndex = text.indexOf(']]', linkStart);
  if (closeIndex === -1) return null;

  const inner = text.slice(linkStart, closeIndex);
  const pipeIndex = inner.indexOf('|');
  const linkPath = (pipeIndex === -1 ? inner : inner.slice(0, pipeIndex)).trim();
  if (!linkPath) return null;

  const alias = pipeIndex === -1 ? undefined : inner.slice(pipeIndex + 1).trim();
  const endIndex = closeIndex + 2;
  return {
    raw: text.slice(mentionStart, endIndex),
    linkPath,
    alias: alias || undefined,
    endIndex,
  };
}

export function getVaultFileAliases(app: Pick<App, 'metadataCache'>, file: TFile): string[] {
  const cache = app.metadataCache?.getFileCache?.(file);
  return parseFrontMatterAliases(cache?.frontmatter ?? null) ?? [];
}

export function resolveVaultWikilinkTarget(
  app: Pick<App, 'metadataCache' | 'vault'>,
  linkPath: string,
  sourcePath = '',
): TFile | TFolder | null {
  const normalizedPath = normalizeMentionPath(linkPath);
  const direct = app.vault.getAbstractFileByPath(normalizedPath);
  if (direct instanceof TFile || direct instanceof TFolder) return direct;

  if (!/\.[^/]+$/.test(normalizedPath)) {
    const markdownFile = app.vault.getAbstractFileByPath(`${normalizedPath}.md`);
    if (markdownFile instanceof TFile) return markdownFile;
  }

  const linkedFile = app.metadataCache?.getFirstLinkpathDest?.(linkPath, sourcePath);
  return linkedFile instanceof TFile ? linkedFile : null;
}

export function buildExternalContextLookup(
  files: ExternalContextFile[]
): Map<string, string> {
  const lookup = new Map<string, string>();
  for (const file of files) {
    const normalized = normalizeMentionPath(file.relativePath);
    if (!normalized) continue;
    const key = normalizeForPlatformLookup(normalized);
    if (!lookup.has(key)) {
      lookup.set(key, file.path);
    }
  }
  return lookup;
}

export function resolveExternalMentionAtIndex(
  text: string,
  mentionStart: number,
  contextEntries: ExternalContextDisplayEntry[],
  getContextLookup: (contextRoot: string) => Map<string, string>
): MentionLookupMatch | null {
  const mentionBodyStart = mentionStart + 1;
  let bestMatch: MentionLookupMatch | null = null;

  for (const entry of contextEntries) {
    const displayNameEnd = mentionBodyStart + entry.displayName.length;
    if (displayNameEnd >= text.length) continue;

    const mentionDisplayName = text.slice(mentionBodyStart, displayNameEnd).toLowerCase();
    if (mentionDisplayName !== entry.displayNameLower) continue;

    const separator = text[displayNameEnd];
    if (separator !== '/' && separator !== '\\') continue;

    const lookup = getContextLookup(entry.contextRoot);
    const match = findBestMentionLookupMatch(
      text,
      displayNameEnd + 1,
      lookup,
      normalizeMentionPath,
      normalizeForPlatformLookup
    );
    if (!match) continue;

    if (!bestMatch || match.endIndex > bestMatch.endIndex) {
      bestMatch = match;
    }
  }

  return bestMatch;
}

export function findBestMentionLookupMatch(
  text: string,
  pathStart: number,
  pathLookup: Map<string, string>,
  normalizePath: (pathText: string) => string,
  normalizeLookupKey: (value: string) => string
): MentionLookupMatch | null {
  if (pathLookup.size === 0 || pathStart >= text.length) return null;

  const endCandidates = collectMentionEndCandidates(text, pathStart);
  for (const endIndex of endCandidates) {
    if (endIndex <= pathStart) continue;

    const rawPath = text.slice(pathStart, endIndex);
    const trailingPunctuation = rawPath.match(TRAILING_PUNCTUATION_REGEX)?.[0] ?? '';
    const rawPathWithoutPunctuation = trailingPunctuation
      ? rawPath.slice(0, -trailingPunctuation.length)
      : rawPath;

    const normalizedPath = normalizePath(rawPathWithoutPunctuation);
    if (!normalizedPath) continue;

    const resolvedPath = pathLookup.get(normalizeLookupKey(normalizedPath));
    if (resolvedPath) {
      return {
        resolvedPath,
        endIndex,
        trailingPunctuation,
      };
    }
  }

  return null;
}

export function createExternalContextLookupGetter(
  getContextFiles: (contextRoot: string) => ExternalContextFile[]
): (contextRoot: string) => Map<string, string> {
  const lookupCache = new Map<string, Map<string, string>>();

  return (contextRoot: string): Map<string, string> => {
    const cached = lookupCache.get(contextRoot);
    if (cached) return cached;

    const lookup = buildExternalContextLookup(getContextFiles(contextRoot));
    lookupCache.set(contextRoot, lookup);
    return lookup;
  };
}

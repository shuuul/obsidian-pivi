import type { App } from 'obsidian';
import { parseFrontMatterAliases, TFile, TFolder } from 'obsidian';

import type { ExternalContextDisplayEntry } from './types';

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
    if (char === undefined) continue;
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
  const currentChar = text[index];
  if (currentChar !== '@') return false;
  if (index === 0) return true;
  const previousChar = text[index - 1];
  return previousChar !== undefined && isWhitespace(previousChar);
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

/**
 * Resolves an external-context root mention such as `@Folder` or `@Folder/`.
 * Nested file paths under the root are intentionally not resolved; roots guide
 * the agent into absolute directories via tools.
 */
export function resolveExternalRootMentionAtIndex(
  text: string,
  mentionStart: number,
  contextEntries: ExternalContextDisplayEntry[],
): MentionLookupMatch | null {
  if (!isMentionStart(text, mentionStart)) return null;

  const mentionBodyStart = mentionStart + 1;
  let bestMatch: MentionLookupMatch | null = null;

  for (const entry of contextEntries) {
    const displayNameEnd = mentionBodyStart + entry.displayName.length;
    if (displayNameEnd > text.length) continue;

    const mentionDisplayName = text.slice(mentionBodyStart, displayNameEnd).toLowerCase();
    if (mentionDisplayName !== entry.displayNameLower) continue;

    let endIndex = displayNameEnd;
    const separator = text[displayNameEnd];
    if (separator === '/' || separator === '\\') {
      endIndex = displayNameEnd + 1;
      const afterSlash = text[endIndex];
      // Root-only: do not consume nested path segments after the trailing slash.
      if (afterSlash && !isWhitespace(afterSlash) && !BOUNDARY_PUNCTUATION.has(afterSlash)) {
        continue;
      }
    } else {
      if (separator !== undefined && !isWhitespace(separator) && !BOUNDARY_PUNCTUATION.has(separator)) {
        // Longer token continues past the display name (e.g. @FolderNameExtra)
        continue;
      }
    }

    const trailingPunctuation = text.slice(endIndex).match(TRAILING_PUNCTUATION_REGEX)?.[0] ?? '';
    if (trailingPunctuation) {
      endIndex += trailingPunctuation.length;
    }

    const bestDisplayLength = bestMatch
      ? (contextEntries.find((candidate) => candidate.contextRoot === bestMatch?.resolvedPath)?.displayName.length ?? 0)
      : 0;
    if (
      !bestMatch
      || entry.displayName.length > bestDisplayLength
      || (entry.displayName.length === bestDisplayLength && endIndex > bestMatch.endIndex)
    ) {
      bestMatch = {
        resolvedPath: entry.contextRoot,
        endIndex,
        trailingPunctuation,
      };
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

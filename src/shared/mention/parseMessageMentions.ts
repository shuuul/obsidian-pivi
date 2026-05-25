import { TFile, TFolder } from 'obsidian';

import {
  isMentionStart,
  normalizeForPlatformLookup,
  normalizeMentionPath,
  resolveExternalMentionAtIndex,
} from '../../utils/contextMentionResolver';
import { parseInlineContextToken } from '../../utils/inlineContext';
import type {
  AgentMentionPart,
  FileMentionPart,
  FolderMentionPart,
  InlineContextMentionPart,
  McpMentionPart,
  MentionBadgeParseContext,
  MentionBadgePart,
  SkillMentionPart,
} from './mentionBadgeTypes';

const AGENT_MENTION_REGEX = /^@([^\s(]+)\s+\(agent\)/;
const INLINE_CONTEXT_TOKEN_REGEX = /^@\[obsius-inline-context:[A-Za-z0-9_-]+\]/;
const MCP_SLASH_REGEX = /^\/([a-zA-Z0-9._-]+)(?:\/([^\s]+))?/;
const SLASH_COMMAND_REGEX = /^\/([a-zA-Z][a-zA-Z0-9_-]*)/;
const MENTION_BODY_REGEX = /^@([^\s]+)/;

function isSlashCommandStart(text: string, index: number): boolean {
  if (text[index] !== '/') return false;
  if (index === 0) return true;
  return /\s/.test(text[index - 1]);
}

function findNextSpecialIndex(text: string, from: number): number {
  let index = from;
  while (index < text.length) {
    if (isMentionStart(text, index) || isSlashCommandStart(text, index)) {
      return index;
    }
    index++;
  }
  return text.length;
}

function tryParseAgent(text: string, index: number): AgentMentionPart | null {
  const slice = text.slice(index);
  const match = slice.match(AGENT_MENTION_REGEX);
  if (!match) return null;

  const raw = match[0];
  const agentId = match[1];
  return {
    kind: 'agent',
    raw,
    agentId,
    label: agentId,
  };
}

function tryParseInlineContext(text: string, index: number): InlineContextMentionPart | null {
  const slice = text.slice(index);
  const match = slice.match(INLINE_CONTEXT_TOKEN_REGEX);
  if (!match) return null;

  const raw = match[0];
  const context = parseInlineContextToken(raw);
  if (!context) return null;

  const range = `${context.selection.from.line + 1}:${context.selection.from.ch + 1}`
    + `–${context.selection.to.line + 1}:${context.selection.to.ch + 1}`;
  return {
    kind: 'inline-context',
    raw,
    context,
    label: `${context.noteName} ${range}`,
  };
}

function tryParseSlash(text: string, index: number, ctx: MentionBadgeParseContext): SkillMentionPart | null {
  const slice = text.slice(index);
  const match = slice.match(SLASH_COMMAND_REGEX);
  if (!match) return null;

  const commandName = match[1];
  const raw = match[0];
  if (ctx.skillCommandNames && !ctx.skillCommandNames.has(commandName)) {
    return null;
  }

  return {
    kind: 'skill',
    raw,
    commandName,
  };
}

function tryParseSlashMcp(text: string, index: number, mcpServerNames: Set<string>): McpMentionPart | null {
  const slice = text.slice(index);
  const match = slice.match(MCP_SLASH_REGEX);
  if (!match) return null;

  const serverName = match[1];
  if (!mcpServerNames.has(serverName)) {
    return null;
  }

  return {
    kind: 'mcp',
    raw: match[0],
    serverName,
    toolName: match[2],
  };
}

function tryParseExternal(
  text: string,
  index: number,
  ctx: MentionBadgeParseContext,
): FileMentionPart | null {
  const entries = ctx.externalContextEntries;
  const getLookup = ctx.getExternalContextLookup;
  if (!entries?.length || !getLookup) return null;

  const resolved = resolveExternalMentionAtIndex(text, index, entries, getLookup);
  if (!resolved) return null;

  const raw = text.slice(index, resolved.endIndex);
  const label = normalizeMentionPath(raw.slice(1).replace(TRAILING_PUNCTUATION, ''));
  const segments = label.split('/');
  const displayLabel = segments[segments.length - 1] || label;

  return {
    kind: 'file',
    raw,
    path: resolved.resolvedPath,
    label: displayLabel,
  };
}

const TRAILING_PUNCTUATION = /[),.!?:;]+$/;

function stripTrailingPunctuation(value: string): string {
  return value.replace(TRAILING_PUNCTUATION, '');
}

function tryParseVault(
  text: string,
  index: number,
  ctx: MentionBadgeParseContext,
): FileMentionPart | FolderMentionPart | null {
  const slice = text.slice(index);
  const match = slice.match(MENTION_BODY_REGEX);
  if (!match) return null;

  const raw = match[0];
  const body = stripTrailingPunctuation(match[1]);
  if (!body) return null;

  const normalizedPath = normalizeMentionPath(body);
  if (!normalizedPath) return null;

  if (body.endsWith('/')) {
    const folderPath = normalizedPath;
    const abstract = ctx.app.vault.getAbstractFileByPath(folderPath);
    if (abstract instanceof TFolder) {
      return {
        kind: 'folder',
        raw,
        path: abstract.path,
        label: abstract.name,
      };
    }
    const label = folderPath.split('/').filter(Boolean).pop() ?? folderPath;
    return {
      kind: 'folder',
      raw,
      path: folderPath,
      label,
    };
  }

  const direct = ctx.app.vault.getAbstractFileByPath(normalizedPath);
  if (direct instanceof TFile) {
    return {
      kind: 'file',
      raw,
      path: direct.path,
      label: direct.basename,
    };
  }
  if (direct instanceof TFolder) {
    return {
      kind: 'folder',
      raw,
      path: direct.path,
      label: direct.name,
    };
  }

  const files = ctx.app.vault.getFiles();
  const byBasename = files.find((file) => file.basename === body);
  if (byBasename) {
    return {
      kind: 'file',
      raw,
      path: byBasename.path,
      label: byBasename.basename,
    };
  }

  return null;
}

function partLength(part: MentionBadgePart): number {
  if (part.kind === 'plain') return part.text.length;
  return part.raw.length;
}

export function parseMessageMentions(text: string, ctx: MentionBadgeParseContext): MentionBadgePart[] {
  if (!text) {
    return [{ kind: 'plain', text: '' }];
  }

  const parts: MentionBadgePart[] = [];
  let index = 0;

  while (index < text.length) {
    if (isSlashCommandStart(text, index)) {
      const slashMcp = tryParseSlashMcp(text, index, ctx.mcpServerNames);
      if (slashMcp) {
        parts.push(slashMcp);
        index += partLength(slashMcp);
        continue;
      }

      const slash = tryParseSlash(text, index, ctx);
      if (slash) {
        parts.push(slash);
        index += partLength(slash);
        continue;
      }
      appendPlain(parts, text[index]);
      index += 1;
      continue;
    }

    if (isMentionStart(text, index)) {
      const inlineContext = tryParseInlineContext(text, index);
      if (inlineContext) {
        parts.push(inlineContext);
        index += partLength(inlineContext);
        continue;
      }

      const agent = tryParseAgent(text, index);
      if (agent) {
        parts.push(agent);
        index += partLength(agent);
        continue;
      }

      const external = tryParseExternal(text, index, ctx);
      if (external) {
        parts.push(external);
        index += partLength(external);
        continue;
      }

      const vault = tryParseVault(text, index, ctx);
      if (vault) {
        parts.push(vault);
        index += partLength(vault);
        continue;
      }

      appendPlain(parts, text[index]);
      index += 1;
      continue;
    }

    const nextSpecial = findNextSpecialIndex(text, index);
    const plainText = text.slice(index, nextSpecial);
    if (plainText) {
      appendPlain(parts, plainText);
    }
    index = nextSpecial;
  }

  return parts.length > 0 ? parts : [{ kind: 'plain', text }];
}

function appendPlain(parts: MentionBadgePart[], text: string): void {
  const last = parts[parts.length - 1];
  if (last?.kind === 'plain') {
    last.text += text;
    return;
  }
  parts.push({ kind: 'plain', text });
}

export function messageTextHasMentionBadges(text: string): boolean {
  if (!text) return false;
  if (/@\[obsius-inline-context:/.test(text)) return true;
  if (/@/.test(text)) return true;
  return /(?:^|\s)\//m.test(text);
}

export function collectUniqueMentionParts(parts: MentionBadgePart[]): MentionBadgePart[] {
  const seen = new Set<string>();
  const unique: MentionBadgePart[] = [];

  for (const part of parts) {
    if (part.kind === 'plain') continue;
    const key = `${part.kind}:${part.raw}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(part);
  }

  return unique;
}

export function buildExternalContextLookupFromPaths(
  paths: string[],
  scanPaths: (roots: string[]) => { relativePath: string; path: string }[],
): (contextRoot: string) => Map<string, string> {
  const cache = new Map<string, Map<string, string>>();

  return (contextRoot: string): Map<string, string> => {
    const cached = cache.get(contextRoot);
    if (cached) return cached;

    const files = scanPaths([contextRoot]);
    const lookup = new Map<string, string>();
    for (const file of files) {
      const normalized = normalizeMentionPath(file.relativePath);
      if (!normalized) continue;
      const key = normalizeForPlatformLookup(normalized);
      if (!lookup.has(key)) {
        lookup.set(key, file.path);
      }
    }
    cache.set(contextRoot, lookup);
    return lookup;
  };
}

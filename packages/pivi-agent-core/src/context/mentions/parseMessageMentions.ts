import { GENERATE_IMAGE_TOOL_ID } from '../../skills/commands/slashCommandIds';
import { TOOL_OBSIDIAN_GENERATE_IMAGE } from '../../tools/obsidianToolNames';
import { parseInlineContextToken } from '../inlineContext';
import { formatInlineContextBadgeLabel } from './mentionBadgeLabels';
import {
  findBestMentionLookupMatch,
  isMentionStart,
  normalizeMentionPath,
  parseWikilinkMentionAtIndex,
  resolveExternalRootMentionAtIndex,
} from './mentionResolution';
import type {
  AgentMentionPart,
  FileMentionPart,
  FolderMentionPart,
  InlineContextMentionPart,
  McpMentionPart,
  MentionBadgeParseContext,
  MentionBadgePart,
  MentionVaultLookup,
  SkillMentionPart,
  ToolMentionPart,
} from './mentionTypes';

const AGENT_MENTION_REGEX = /^@([^\s(]+)\s+\(agent\)/;
const INLINE_CONTEXT_TOKEN_REGEX = /^@\[pivi-inline-context:[A-Za-z0-9_-]+\]/;
const MCP_SLASH_REGEX = /^\/([a-zA-Z0-9._-]+)(?:\/([^\s]+))?/;
const SLASH_COMMAND_REGEX = /^\/([a-zA-Z][a-zA-Z0-9_-]*)(?=\s|$)/;
const MENTION_BODY_REGEX = /^@([^\s]+)/;

function isSlashCommandStart(text: string, index: number): boolean {
  if (text[index] !== '/') return false;
  if (index === 0) return true;
  return /\s/.test(text[index - 1] ?? '');
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
  if (!raw || !agentId) return null;
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
  if (!raw) return null;
  const context = parseInlineContextToken(raw);
  if (!context) return null;

  return {
    kind: 'inline-context',
    raw,
    context,
    label: formatInlineContextBadgeLabel(context),
  };
}

function tryParseSlash(text: string, index: number): SkillMentionPart | null {
  const slice = text.slice(index);
  const match = slice.match(SLASH_COMMAND_REGEX);
  if (!match) return null;

  const commandName = match[1];
  const raw = match[0];
  if (!commandName || !raw) return null;

  return {
    kind: 'skill',
    raw,
    commandName,
  };
}

function tryParseSlashTool(text: string, index: number): ToolMentionPart | null {
  const slice = text.slice(index);
  const match = slice.match(SLASH_COMMAND_REGEX);
  if (!match || match[1] !== GENERATE_IMAGE_TOOL_ID || !match[0]) return null;
  return {
    kind: 'tool',
    raw: match[0],
    toolName: TOOL_OBSIDIAN_GENERATE_IMAGE,
  };
}

function tryParseSlashMcp(text: string, index: number, mcpServerNames: Set<string>): McpMentionPart | null {
  const slice = text.slice(index);
  const match = slice.match(MCP_SLASH_REGEX);
  if (!match) return null;

  const serverName = match[1];
  const raw = match[0];
  if (!serverName || !raw || !mcpServerNames.has(serverName)) {
    return null;
  }

  return {
    kind: 'mcp',
    raw,
    serverName,
    toolName: match[2],
  };
}

function tryParseExternal(
  text: string,
  index: number,
  ctx: MentionBadgeParseContext,
): FolderMentionPart | null {
  const entries = ctx.externalContextEntries;
  if (!entries?.length) return null;

  const resolved = resolveExternalRootMentionAtIndex(text, index, entries);
  if (!resolved) return null;

  const raw = text.slice(index, resolved.endIndex);
  const matchingEntry = entries.find((entry) => entry.contextRoot === resolved.resolvedPath);
  const displayLabel = matchingEntry?.displayName
    ?? basename(normalizeMentionPath(raw.slice(1).replace(TRAILING_PUNCTUATION, '')));

  return {
    kind: 'folder',
    raw,
    path: resolved.resolvedPath,
    label: displayLabel,
  };
}

const TRAILING_PUNCTUATION = /[),.!?:;]+$/;

function stripTrailingPunctuation(value: string): string {
  return value.replace(TRAILING_PUNCTUATION, '');
}

function basename(path: string): string {
  return path.split('/').filter(Boolean).pop() ?? path;
}

function normalizeVaultLookupKey(vault: MentionVaultLookup, value: string): string {
  return vault.normalizeLookupKey?.(value) ?? value;
}

function buildVaultMentionLookup(vault: MentionVaultLookup): Map<string, string> {
  const lookup = new Map<string, string>();
  for (const file of vault.getFiles()) {
    lookup.set(normalizeVaultLookupKey(vault, normalizeMentionPath(file.path)), file.path);
  }

  for (const folder of vault.getFolders()) {
    lookup.set(normalizeVaultLookupKey(vault, normalizeMentionPath(folder.path)), folder.path);
  }
  return lookup;
}

function tryParseVaultWikilink(
  text: string,
  index: number,
  ctx: MentionBadgeParseContext,
): FileMentionPart | FolderMentionPart | null {
  const wikilink = parseWikilinkMentionAtIndex(text, index);
  if (!wikilink) return null;

  const target = ctx.vault.resolveWikilink(wikilink.linkPath);
  if (target?.kind === 'file') {
    return {
      kind: 'file',
      raw: wikilink.raw,
      path: target.path,
      label: wikilink.alias ?? target.basename,
    };
  }
  if (target?.kind === 'folder') {
    return {
      kind: 'folder',
      raw: wikilink.raw,
      path: target.path,
      label: wikilink.alias ?? target.name,
    };
  }

  return null;
}

function tryParseVaultByLookup(
  text: string,
  index: number,
  ctx: MentionBadgeParseContext,
): FileMentionPart | FolderMentionPart | null {
  const match = findBestMentionLookupMatch(
    text,
    index + 1,
    buildVaultMentionLookup(ctx.vault),
    normalizeMentionPath,
    (value) => normalizeVaultLookupKey(ctx.vault, value),
  );
  if (!match) return null;

  const raw = text.slice(index, match.endIndex);
  const abstract = ctx.vault.getByPath(match.resolvedPath);
  if (abstract?.kind === 'file') {
    return {
      kind: 'file',
      raw,
      path: abstract.path,
      label: abstract.basename,
    };
  }
  if (abstract?.kind === 'folder') {
    return {
      kind: 'folder',
      raw,
      path: abstract.path,
      label: abstract.name,
    };
  }

  const file = ctx.vault.getFiles().find((candidate) => candidate.path === match.resolvedPath);
  if (file) {
    return {
      kind: 'file',
      raw,
      path: file.path,
      label: file.basename,
    };
  }

  return null;
}

function tryParseVault(
  text: string,
  index: number,
  ctx: MentionBadgeParseContext,
): FileMentionPart | FolderMentionPart | null {
  const lookupMatch = tryParseVaultByLookup(text, index, ctx);
  if (lookupMatch) return lookupMatch;

  const slice = text.slice(index);
  const match = slice.match(MENTION_BODY_REGEX);
  if (!match) return null;

  const raw = match[0];
  const mentionBody = match[1];
  if (!raw || !mentionBody) return null;
  const body = stripTrailingPunctuation(mentionBody);
  if (!body) return null;

  const normalizedPath = normalizeMentionPath(body);
  if (!normalizedPath) return null;

  if (body.endsWith('/')) {
    const folderPath = normalizedPath;
    const abstract = ctx.vault.getByPath(folderPath);
    if (abstract?.kind === 'folder') {
      return {
        kind: 'folder',
        raw,
        path: abstract.path,
        label: abstract.name,
      };
    }
    return {
      kind: 'folder',
      raw,
      path: folderPath,
      label: basename(folderPath),
    };
  }

  const direct = ctx.vault.getByPath(normalizedPath);
  if (direct?.kind === 'file') {
    return {
      kind: 'file',
      raw,
      path: direct.path,
      label: direct.basename,
    };
  }
  if (direct?.kind === 'folder') {
    return {
      kind: 'folder',
      raw,
      path: direct.path,
      label: direct.name,
    };
  }

  const files = ctx.vault.getFiles();
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

      const slashTool = tryParseSlashTool(text, index);
      if (slashTool) {
        parts.push(slashTool);
        index += partLength(slashTool);
        continue;
      }

      const slash = tryParseSlash(text, index);
      if (slash) {
        parts.push(slash);
        index += partLength(slash);
        continue;
      }
      appendPlain(parts, text[index] ?? '');
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

      const vaultWikilink = tryParseVaultWikilink(text, index, ctx);
      if (vaultWikilink) {
        parts.push(vaultWikilink);
        index += partLength(vaultWikilink);
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

      appendPlain(parts, text[index] ?? '');
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
  if (/@\[pivi-inline-context:/.test(text)) return true;
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

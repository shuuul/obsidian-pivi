import type { MentionBadgePart } from '@pivi/pivi-agent-core/context/mentions';
import type { MentionBadgeParseContext } from '@pivi/pivi-agent-core/context/mentions';
import { messageTextHasMentionBadges, parseMessageMentions } from '@pivi/pivi-agent-core/context/mentions';

import type { ContextBadgePart, ContextBadgeToken } from './ContextBadgeTypes';

export function mentionPartToContextBadgeToken(part: Exclude<MentionBadgePart, { kind: 'plain' }>): ContextBadgeToken {
  switch (part.kind) {
    case 'file':
      return { kind: 'file', token: part.raw, path: part.path, label: part.label };
    case 'folder':
      return {
        kind: 'folder',
        token: part.raw,
        path: part.path,
        label: part.label,
        source: part.path.startsWith('/') || /^[A-Za-z]:[\\/]/.test(part.path) ? 'external' : 'vault',
      };
    case 'mcp':
      return { kind: 'mcp', token: part.raw, serverName: part.serverName, toolName: part.toolName };
    case 'skill':
      return { kind: 'skill', token: part.raw, commandName: part.commandName };
    case 'agent':
      return { kind: 'agent', token: part.raw, agentId: part.agentId, label: part.label };
    case 'inline-context':
      return { kind: 'inline-context', token: part.raw, context: part.context, label: part.label };
  }
}

export function contextBadgeTokenToMentionPart(token: ContextBadgeToken): MentionBadgePart {
  switch (token.kind) {
    case 'file':
      return { kind: 'file', raw: token.token, path: token.path, label: token.label ?? token.path };
    case 'folder':
      return { kind: 'folder', raw: token.token, path: token.path, label: token.label ?? token.path };
    case 'mcp':
      return { kind: 'mcp', raw: token.token, serverName: token.serverName, toolName: token.toolName };
    case 'skill':
      return { kind: 'skill', raw: token.token, commandName: token.commandName };
    case 'agent':
      return { kind: 'agent', raw: token.token, agentId: token.agentId, label: token.label };
    case 'inline-context':
      return { kind: 'inline-context', raw: token.token, context: token.context, label: token.label ?? token.context.noteName };
    case 'attachment':
      return { kind: 'file', raw: token.token, path: token.path, label: token.label ?? token.path };
  }
}

export function parseContextBadges(text: string, ctx: MentionBadgeParseContext): ContextBadgePart[] {
  return parseMessageMentions(text, ctx).map((part) => {
    if (part.kind === 'plain') return part;
    return { kind: 'badge', token: mentionPartToContextBadgeToken(part) };
  });
}

export { messageTextHasMentionBadges };

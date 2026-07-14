import type { MentionBadgePart } from '@pivi/pivi-agent-core/context/mentions';
import { messageTextHasMentionBadges } from '@pivi/pivi-agent-core/context/mentions';

import type { ContextBadgeToken } from './ContextBadgeTypes';

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
        source: part.path.startsWith('/') || /^[A-Za-z]:[\\/]/.test(part.path) ? 'external' : 'workspace',
      };
    case 'mcp':
      return { kind: 'mcp', token: part.raw, serverName: part.serverName, toolName: part.toolName };
    case 'skill':
      return { kind: 'skill', token: part.raw, commandName: part.commandName };
    case 'tool':
      return { kind: 'tool', token: part.raw, toolName: part.toolName };
    case 'agent':
      return { kind: 'agent', token: part.raw, agentId: part.agentId, label: part.label };
    case 'inline-context':
      return { kind: 'inline-context', token: part.raw, context: part.context, label: part.label };
  }
}

export { messageTextHasMentionBadges };

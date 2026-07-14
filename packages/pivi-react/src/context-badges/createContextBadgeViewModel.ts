import { formatInlineContextBadgeLabel } from '@pivi/pivi-agent-core/context/mentions';

import type { TFunction } from '../i18n/types';
import {
  formatInlineContextTooltip,
  formatMcpBadgeLabel,
  formatRemoveInlineContextAriaLabel,
  formatSkillBadgeLabel,
  formatToolBadgeLabel,
} from './labels';
import type { ContextBadgeIcon, ContextBadgeToken, ContextBadgeViewModel } from './types';

export function getContextBadgeFileIconName(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'md':
      return 'file-text';
    case 'png':
    case 'jpg':
    case 'jpeg':
    case 'gif':
    case 'webp':
    case 'svg':
      return 'image';
    case 'pdf':
      return 'file-text';
    default:
      return 'file';
  }
}

function basename(path: string): string {
  const normalized = path.replace(/\\/g, '/');
  return normalized.split('/').filter(Boolean).pop() || path;
}

function iconForToken(token: ContextBadgeToken): ContextBadgeIcon {
  switch (token.kind) {
    case 'file':
    case 'attachment':
      return { name: getContextBadgeFileIconName(token.path) };
    case 'folder':
      return { name: token.source === 'external' ? 'database-search' : 'folder' };
    case 'mcp':
      return { custom: 'mcp' };
    case 'skill':
      return { name: 'sparkles' };
    case 'tool':
      return { name: 'image-plus' };
    case 'agent':
      return { name: 'bot' };
    case 'inline-context':
      return { name: 'text-select' };
  }
}

export function createContextBadgeViewModel(
  token: ContextBadgeToken,
  t: TFunction,
): ContextBadgeViewModel {
  switch (token.kind) {
    case 'file':
      return {
        kind: token.kind,
        token: token.token,
        label: token.label ?? basename(token.path),
        tooltip: token.path,
        icon: iconForToken(token),
        tone: 'context',
        clickable: true,
        removable: false,
      };
    case 'folder':
      return {
        kind: token.kind,
        token: token.token,
        label: token.label ?? basename(token.path),
        tooltip: token.path,
        icon: iconForToken(token),
        tone: 'context',
        clickable: false,
        removable: false,
        disabled: true,
      };
    case 'mcp': {
      const label = formatMcpBadgeLabel(token.serverName, token.toolName);
      return {
        kind: token.kind,
        token: token.token,
        label,
        tooltip: token.toolName
          ? t('chat.contextBadges.mcpToolTooltip', {
              server: token.serverName,
              tool: token.toolName,
            })
          : t('chat.contextBadges.mcpServerTooltip', { server: token.serverName }),
        icon: iconForToken(token),
        tone: 'tool',
        clickable: false,
        removable: false,
        disabled: true,
      };
    }
    case 'skill': {
      const label = formatSkillBadgeLabel(token.commandName);
      return {
        kind: token.kind,
        token: token.token,
        label,
        tooltip: t('chat.contextBadges.skillTooltip', { skill: label }),
        icon: iconForToken(token),
        tone: 'tool',
        clickable: false,
        removable: false,
        disabled: true,
      };
    }
    case 'tool': {
      const label = token.label ?? formatToolBadgeLabel(token.toolName);
      return {
        kind: token.kind,
        token: token.token,
        label,
        tooltip: t('chat.contextBadges.toolTooltip', { tool: token.toolName }),
        icon: iconForToken(token),
        tone: 'tool',
        clickable: false,
        removable: false,
        disabled: true,
      };
    }
    case 'agent':
      return {
        kind: token.kind,
        token: token.token,
        label: `@${token.label}`,
        tooltip: t('chat.contextBadges.agentTooltip', { agent: token.agentId }),
        icon: iconForToken(token),
        tone: 'tool',
        clickable: false,
        removable: false,
        disabled: true,
      };
    case 'inline-context':
      return {
        kind: token.kind,
        token: token.token,
        label: token.label ?? formatInlineContextBadgeLabel(token.context),
        tooltip: formatInlineContextTooltip(token.context, t),
        icon: iconForToken(token),
        tone: 'inline',
        clickable: false,
        removable: true,
        disabled: true,
        ariaLabel: formatInlineContextTooltip(token.context, t),
        removeAriaLabel: formatRemoveInlineContextAriaLabel(token.context, t),
      };
    case 'attachment':
      return {
        kind: token.kind,
        token: token.token,
        label: token.label ?? basename(token.path),
        tooltip: token.path,
        icon: iconForToken(token),
        tone: 'attachment',
        clickable: true,
        removable: true,
        removeAriaLabel: t('common.remove'),
      };
  }
}

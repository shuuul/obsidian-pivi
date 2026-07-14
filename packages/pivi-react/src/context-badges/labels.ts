import type { InlineContextReference } from '@pivi/pivi-agent-core/context/inlineContext';
import {
  formatInlineContextPreview,
  formatInlineContextRange,
} from '@pivi/pivi-agent-core/context/mentions';

import type { TFunction } from '../i18n/types';

/** Visible label for a skill slash token (no leading `/`). */
export function formatSkillBadgeLabel(commandName: string): string {
  return commandName.startsWith('/') ? commandName.slice(1) : commandName;
}

/** Human-readable label for a canonical Pivi tool name. */
export function formatToolBadgeLabel(toolName: string): string {
  return toolName.replace(/^obsidian_/, '').replace(/_/g, ' ');
}

/** Visible label for an MCP slash token (no leading `/`). */
export function formatMcpBadgeLabel(serverName: string, toolName?: string): string {
  return toolName ?? serverName;
}

export function formatInlineContextTooltip(
  context: InlineContextReference,
  t: TFunction,
): string {
  const range = formatInlineContextRange(context);
  const preview = formatInlineContextPreview(context, 160);
  return [
    t('chat.contextBadges.inlineContextSource', { path: context.notePath }),
    t('chat.contextBadges.inlineContextSelection', { range }),
    preview ? t('chat.contextBadges.inlineContextPreview', { preview }) : '',
  ].filter(Boolean).join('\n');
}

export function formatRemoveInlineContextAriaLabel(
  context: InlineContextReference,
  t: TFunction,
): string {
  return t('chat.contextBadges.removeInlineContext', {
    note: context.noteName,
    range: formatInlineContextRange(context),
  });
}

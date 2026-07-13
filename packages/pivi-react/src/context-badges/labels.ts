import type { InlineContextReference } from '@pivi/pivi-agent-core/context/inlineContext';
import {
  formatInlineContextPreview,
  formatInlineContextRange,
} from '@pivi/pivi-agent-core/context/mentions';

/** Visible label for a skill slash token (no leading `/`). */
export function formatSkillBadgeLabel(commandName: string): string {
  return commandName.startsWith('/') ? commandName.slice(1) : commandName;
}

/** Visible label for an MCP slash token (no leading `/`). */
export function formatMcpBadgeLabel(serverName: string, toolName?: string): string {
  return toolName ?? serverName;
}

export function formatInlineContextTooltip(context: InlineContextReference): string {
  const range = formatInlineContextRange(context);
  const preview = formatInlineContextPreview(context, 160);
  return [
    `Inline context from ${context.notePath}`,
    `Selection: ${range}`,
    preview ? `Preview: ${preview}` : '',
  ].filter(Boolean).join('\n');
}

export function formatRemoveInlineContextAriaLabel(context: InlineContextReference): string {
  return `Remove inline context from ${context.noteName} ${formatInlineContextRange(context)}`;
}

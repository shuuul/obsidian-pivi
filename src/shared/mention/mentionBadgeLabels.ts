import type { InlineContextReference } from '../../utils/inlineContext';

/** Visible label for a skill slash token (no leading `/`). */
export function formatSkillBadgeLabel(commandName: string): string {
  return commandName.startsWith('/') ? commandName.slice(1) : commandName;
}

/** Visible label for an MCP slash token (no leading `/`). */
export function formatMcpBadgeLabel(serverName: string, toolName?: string): string {
  return toolName ? `${serverName}/${toolName}` : serverName;
}

export function formatInlineContextRange(context: InlineContextReference): string {
  return `${context.selection.from.line + 1}:${context.selection.from.ch + 1}`
    + `–${context.selection.to.line + 1}:${context.selection.to.ch + 1}`;
}

function stripSelectionMarkers(text: string): string {
  return text
    .replace(/<selection_start>/g, '')
    .replace(/<selection_end>/g, '');
}

export function formatInlineContextPreview(context: InlineContextReference, maxLength = 48): string {
  const normalized = stripSelectionMarkers(context.text).replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

export function formatInlineContextBadgeLabel(context: InlineContextReference): string {
  const range = formatInlineContextRange(context);
  const preview = formatInlineContextPreview(context, 36);
  return preview ? `${context.noteName} ${range} · ${preview}` : `${context.noteName} ${range}`;
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

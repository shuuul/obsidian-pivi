import { t } from '@/app/i18n';

import { contentFallback, formatToolDisplayValue, renderLinesExpanded } from './toolCallExpandedShared';
import { appendToolIcon } from './toolCallIcon';

export function renderToolSearchExpanded(container: HTMLElement, result: string): void {
  let toolNames: string[] = [];
  try {
    const parsed = JSON.parse(result) as Array<{ type: string; tool_name: string }>;
    if (Array.isArray(parsed)) {
      toolNames = parsed
        .filter(item => item.type === 'tool_reference' && item.tool_name)
        .map(item => item.tool_name);
    }
  } catch {
    // Fall back to showing raw result
  }

  if (toolNames.length === 0) {
    renderLinesExpanded(container, result);
    return;
  }

  for (const name of toolNames) {
    const lineEl = container.createDiv({ cls: 'pivi-tool-search-item' });
    const iconEl = lineEl.createSpan({ cls: 'pivi-tool-icon pivi-tool-icon--small pivi-tool-search-icon' });
    appendToolIcon(iconEl, name);
    lineEl.createSpan({ text: name });
  }
}
export function renderAgentLifecycleExpanded(container: HTMLElement, result: string): void {
  // Try to parse as JSON for structured display
  const trimmed = result.trim();
  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>;
      const linesEl = container.createDiv({ cls: 'pivi-tool-lines' });
      for (const [key, value] of Object.entries(parsed)) {
        const lineEl = linesEl.createDiv({ cls: 'pivi-tool-line' });
        const displayValue = formatToolDisplayValue(value);
        lineEl.setText(`${key}: ${displayValue}`);
      }
      return;
    } catch { /* fall through to plain text */ }
  }
  renderLinesExpanded(container, result);
}
export function renderBashContent(
  container: HTMLElement,
  input: Record<string, unknown>,
  result: string,
  initialText?: string,
): void {
  const command = (input.command as string) || '';
  if (command) {
    const cmdEl = container.createDiv({ cls: 'pivi-tool-bash-command' });
    cmdEl.setText(`$ ${command}`);
  }
  if (initialText) {
    contentFallback(container, initialText);
  } else if (result) {
    renderLinesExpanded(container, result);
  } else {
    container.createDiv({ cls: 'pivi-tool-empty', text: t('chat.stream.noResult') });
  }
}

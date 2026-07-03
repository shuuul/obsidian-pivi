import { setIcon } from 'obsidian';

export function parseJsonRecord(result: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(result) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

export function parseJsonArray(result: string): unknown[] | null {
  try {
    const parsed = JSON.parse(result) as unknown;
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function stringField(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

export function inputString(input: Record<string, unknown>, key: string): string {
  const value = input[key];
  return typeof value === 'string' ? value : '';
}

export function renderKeyValueLines(
  container: HTMLElement,
  rows: Array<[string, unknown]>,
  maxRows = 12,
): void {
  const visibleRows = rows.filter(([, value]) => value !== undefined && value !== null && value !== '');
  if (visibleRows.length === 0) {
    container.createDiv({ cls: 'pivi-tool-empty', text: 'No details' });
    return;
  }

  const linesEl = container.createDiv({ cls: 'pivi-tool-lines' });
  const truncated = visibleRows.length > maxRows;
  const displayRows = truncated ? visibleRows.slice(0, maxRows) : visibleRows;
  for (const [label, value] of displayRows) {
    linesEl.createDiv({ cls: 'pivi-tool-line pivi-tool-line-wrap', text: `${label}: ${formatToolDisplayValue(value)}` });
  }
  if (truncated) {
    linesEl.createDiv({ cls: 'pivi-tool-truncated', text: `... ${visibleRows.length - maxRows} more fields` });
  }
}

export function renderLinesExpanded(
  container: HTMLElement,
  result: string,
  maxLines: number,
  hoverable = false
): void {
  const lines = result.split(/\r?\n/);
  const truncated = lines.length > maxLines;
  const displayLines = truncated ? lines.slice(0, maxLines) : lines;

  const linesEl = container.createDiv({ cls: 'pivi-tool-lines' });
  for (const line of displayLines) {
    const stripped = line.replace(/^\s*\d+→/, '');
    const lineEl = linesEl.createDiv({ cls: 'pivi-tool-line' });
    if (hoverable) lineEl.addClass('hoverable');
    lineEl.setText(stripped || ' ');
  }

  if (truncated) {
    linesEl.createDiv({
      cls: 'pivi-tool-truncated',
      text: `... ${lines.length - maxLines} more lines`,
    });
  }
}

export interface VaultPathLine {
  path: string;
  displayPath?: string;
  clickable?: boolean;
}

export function renderVaultPathLines(
  container: HTMLElement,
  paths: VaultPathLine[],
  maxLines: number,
): void {
  const truncated = paths.length > maxLines;
  const displayPaths = truncated ? paths.slice(0, maxLines) : paths;
  const linesEl = container.createDiv({ cls: 'pivi-tool-lines' });

  for (const pathLine of displayPaths) {
    const lineEl = linesEl.createDiv({ cls: 'pivi-tool-line pivi-tool-line-path hoverable' });
    appendVaultPath(lineEl, pathLine.path, pathLine.displayPath ?? pathLine.path, pathLine.clickable);
  }

  if (truncated) {
    linesEl.createDiv({
      cls: 'pivi-tool-truncated',
      text: `... ${paths.length - maxLines} more paths`,
    });
  }
}

export function appendVaultPath(
  parent: HTMLElement,
  path: string,
  displayPath: string,
  clickable = false,
): void {
  if (!clickable) {
    parent.createSpan({ cls: 'pivi-tool-path-text', text: displayPath });
    return;
  }

  const linkEl = parent.createEl('a', {
    cls: 'pivi-tool-path-link pivi-file-link internal-link',
    text: displayPath,
  });
  linkEl.setAttribute('href', path);
  linkEl.setAttribute('data-href', path);
  linkEl.setAttribute('aria-label', `Open ${displayPath} in Obsidian`);
}

export function formatToolDisplayValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return `${value}`;
  }
  if (value === null || value === undefined) {
    return '';
  }
  return JSON.stringify(value);
}

export function contentFallback(container: HTMLElement, text: string): void {
  const resultRow = container.createDiv({ cls: 'pivi-tool-result-row' });
  const resultText = resultRow.createSpan({ cls: 'pivi-tool-result-text' });
  resultText.setText(text);
}

export function appendToolLink(parent: HTMLElement, title: string, url: string): void {
  const linkEl = parent.createEl('a', { cls: 'pivi-tool-link' });
  linkEl.setAttribute('href', url);
  linkEl.setAttribute('target', '_blank');
  linkEl.setAttribute('rel', 'noopener noreferrer');

  const iconEl = linkEl.createSpan({ cls: 'pivi-tool-link-icon' });
  setIcon(iconEl, 'external-link');

  linkEl.createSpan({ cls: 'pivi-tool-link-title', text: title });
}

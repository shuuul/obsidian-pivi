import { setIcon } from 'obsidian';

import { t } from '@/app/i18n';

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
): void {
  const visibleRows = rows.filter(([, value]) => value !== undefined && value !== null && value !== '');
  if (visibleRows.length === 0) {
    container.createDiv({ cls: 'pivi-tool-empty', text: t('chat.stream.noDetails') });
    return;
  }

  const linesEl = container.createDiv({ cls: 'pivi-tool-lines' });
  for (const [label, value] of visibleRows) {
    linesEl.createDiv({ cls: 'pivi-tool-line pivi-tool-line-wrap', text: `${label}: ${formatToolDisplayValue(value)}` });
  }
}

export function renderLinesExpanded(
  container: HTMLElement,
  result: string,
  hoverable = false
): void {
  const linesEl = container.createDiv({ cls: 'pivi-tool-lines' });
  const lineEl = linesEl.createDiv({ cls: 'pivi-tool-line pivi-tool-line-wrap' });
  if (hoverable) lineEl.addClass('hoverable');
  lineEl.setText(result.replace(/^\s*\d+→/gm, '') || ' ');
}

export interface VaultPathLine {
  path: string;
  displayPath?: string;
  clickable?: boolean;
}

export function renderVaultPathLines(
  container: HTMLElement,
  paths: VaultPathLine[],
): void {
  const linesEl = container.createDiv({ cls: 'pivi-tool-lines' });

  for (const pathLine of paths) {
    const lineEl = linesEl.createDiv({ cls: 'pivi-tool-line pivi-tool-line-path hoverable' });
    appendVaultPath(lineEl, pathLine.path, pathLine.displayPath ?? pathLine.path, pathLine.clickable);
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

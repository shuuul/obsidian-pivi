import { t } from '@/i18n';

import { appendToolLink, renderLinesExpanded } from './toolCallExpandedShared';
import { normalizeWebSearchDisplayData } from './toolCallLabels';

export interface WebSearchLink {
  title: string;
  url: string;
}

export function renderFileSearchExpanded(container: HTMLElement, result: string): void {
  const lines = result.split(/\r?\n/).filter(line => line.trim());
  if (lines.length === 0) {
    container.createDiv({ cls: 'pivi-tool-empty', text: t('chat.stream.noMatches') });
    return;
  }
  renderLinesExpanded(container, result, 15, true);
}

export function isPlaceholderWebSearchResult(result: string | undefined): boolean {
  if (!result) return true;
  const normalized = result.trim().toLowerCase();
  return normalized === '' || normalized === 'search complete';
}

export function parseWebSearchResult(result: string): { links: WebSearchLink[]; summary: string } | null {
  const linksMatch = result.match(/Links:\s*(\[[\s\S]*?\])(?:\n|$)/);
  if (!linksMatch) return null;

  try {
    const parsed = JSON.parse(linksMatch[1]) as WebSearchLink[];
    if (!Array.isArray(parsed) || parsed.length === 0) return null;

    const linksEndIndex = result.indexOf(linksMatch[0]) + linksMatch[0].length;
    const summary = result.slice(linksEndIndex).trim();
    return { links: parsed.filter(l => l.title && l.url), summary };
  } catch {
    return null;
  }
}

export function renderWebSearchActionExpanded(container: HTMLElement, input: Record<string, unknown>): boolean {
  const data = normalizeWebSearchDisplayData(input);
  const hasStructuredData = Boolean(data.actionType || data.query || data.queries.length || data.url || data.pattern);
  if (!hasStructuredData) {
    return false;
  }

  const linesEl = container.createDiv({ cls: 'pivi-tool-lines' });

  switch (data.actionType) {
    case 'open_page':
      linesEl.createDiv({ cls: 'pivi-tool-line', text: t('chat.stream.openPage') });
      if (data.url) {
        appendToolLink(linesEl, data.url, data.url);
      } else {
        linesEl.createDiv({ cls: 'pivi-tool-line', text: t('chat.stream.urlUnavailable') });
      }
      return true;

    case 'find_in_page':
      linesEl.createDiv({ cls: 'pivi-tool-line', text: t('chat.stream.findInPage') });
      if (data.url) {
        appendToolLink(linesEl, data.url, data.url);
      } else {
        linesEl.createDiv({ cls: 'pivi-tool-line', text: t('chat.stream.urlUnavailable') });
      }
      if (data.pattern) {
        linesEl.createDiv({ cls: 'pivi-tool-line', text: `Pattern: ${data.pattern}` });
      }
      return true;

    case 'search':
    default: {
      const primaryQuery = data.query || data.queries[0];
      linesEl.createDiv({
        cls: 'pivi-tool-line',
        text: primaryQuery ? `Query: ${primaryQuery}` : 'Search web',
      });

      const alternateQueries = data.queries.filter(query => query !== primaryQuery);
      for (const query of alternateQueries.slice(0, 4)) {
        linesEl.createDiv({ cls: 'pivi-tool-line', text: `Alt query: ${query}` });
      }
      if (alternateQueries.length > 4) {
        linesEl.createDiv({
          cls: 'pivi-tool-truncated',
          text: `... ${alternateQueries.length - 4} more queries`,
        });
      }
      return true;
    }
  }
}

export function renderWebSearchExpanded(
  container: HTMLElement,
  input: Record<string, unknown>,
  result: string | undefined,
): void {
  const parsed = result ? parseWebSearchResult(result) : null;
  if (parsed && parsed.links.length > 0) {
    const linksEl = container.createDiv({ cls: 'pivi-tool-lines' });
    for (const link of parsed.links) {
      appendToolLink(linksEl, link.title, link.url);
    }

    if (parsed.summary) {
      const summaryEl = container.createDiv({ cls: 'pivi-tool-web-summary' });
      summaryEl.setText(parsed.summary.length > 800 ? parsed.summary.slice(0, 800) + '...' : parsed.summary);
    }
    return;
  }

  const data = normalizeWebSearchDisplayData(input);
  const shouldRenderAction = Boolean(data.actionType || data.query || data.queries.length || data.url || data.pattern)
    && (!result
      || isPlaceholderWebSearchResult(result)
      || data.actionType === 'open_page'
      || data.actionType === 'find_in_page');

  if (shouldRenderAction && renderWebSearchActionExpanded(container, input)) {
    if (result && !isPlaceholderWebSearchResult(result)) {
      renderLinesExpanded(container, result, 12);
    }
    return;
  }

  if (result) {
    renderLinesExpanded(container, result, 20);
    return;
  }

  if (renderWebSearchActionExpanded(container, input)) {
    return;
  }

  container.createDiv({ cls: 'pivi-tool-empty', text: t('chat.stream.noResult') });
}
export function renderWebFetchExpanded(container: HTMLElement, result: string): void {
  const maxChars = 500;
  const linesEl = container.createDiv({ cls: 'pivi-tool-lines' });
  const lineEl = linesEl.createDiv({ cls: 'pivi-tool-line pivi-tool-line-wrap' });

  if (result.length > maxChars) {
    lineEl.setText(result.slice(0, maxChars));
    linesEl.createDiv({
      cls: 'pivi-tool-truncated',
      text: `... ${result.length - maxChars} more characters`,
    });
  } else {
    lineEl.setText(result);
  }
}

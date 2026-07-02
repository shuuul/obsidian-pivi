import type { AskUserQuestionItem, AskUserQuestionOption, ToolCallInfo } from '@pivi/core';
import type { DiffStats } from '@pivi/core/diff';
import { parseApplyPatchDiffs, parseFileUpdateChangeDiffs } from '@pivi/tools/diff';
import {
  TOOL_OBSIDIAN_LIST,
  TOOL_OBSIDIAN_SEARCH,
} from '@pivi/tools/obsidianToolNames';
import type { TodoItem } from '@pivi/tools/todo';
import { getToolIcon, MCP_ICON_MARKER } from '@pivi/tools/toolIcons';
import { extractResolvedAnswersFromResultText } from '@pivi/tools/toolInput';
import {
  isAgentLifecycleTool,
  TOOL_APPLY_PATCH,
  TOOL_ASK_USER_QUESTION,
  TOOL_BASH,
  TOOL_GLOB,
  TOOL_GREP,
  TOOL_LS,
  TOOL_READ,
  TOOL_TODO_WRITE,
  TOOL_TOOL_SEARCH,
  TOOL_WEB_FETCH,
  TOOL_WEB_SEARCH,
  TOOL_WRITE_STDIN,
} from '@pivi/tools/toolNames';
import { extractToolResultContent } from '@pivi/tools/toolResultContent';
import { setIcon } from 'obsidian';

import { appendMcpIcon } from '../../shared/utils/icons';
import { setupCollapsible } from './collapsible';
import { renderDiffContent, renderDiffStats } from './DiffRenderer';
import {
  getObsidianToolDisplayName,
  getObsidianToolSummary,
  isObsidianAgentTool,
  isObsidianToolCompactResult,
  parseObsidianSearchHits,
} from './piviToolDisplay';
import { renderTodoItems } from './todoUtils';
import {
  getToolLabel,
  getToolName,
  getToolSummary,
  normalizeWebSearchDisplayData,
} from './toolCallLabels';

export { fileNameOnly, getToolLabel, getToolName, getToolSummary } from './toolCallLabels';

export function setToolIcon(el: HTMLElement, name: string): void {
  const icon = getToolIcon(name);
  if (icon === MCP_ICON_MARKER) {
    appendMcpIcon(el);
  } else {
    setIcon(el, icon);
  }
}

interface WebSearchLink {
  title: string;
  url: string;
}

function appendToolLink(parent: HTMLElement, title: string, url: string): void {
  const linkEl = parent.createEl('a', { cls: 'pivi-tool-link' });
  linkEl.setAttribute('href', url);
  linkEl.setAttribute('target', '_blank');
  linkEl.setAttribute('rel', 'noopener noreferrer');

  const iconEl = linkEl.createSpan({ cls: 'pivi-tool-link-icon' });
  setIcon(iconEl, 'external-link');

  linkEl.createSpan({ cls: 'pivi-tool-link-title', text: title });
}

function isPlaceholderWebSearchResult(result: string | undefined): boolean {
  if (!result) return true;
  const normalized = result.trim().toLowerCase();
  return normalized === '' || normalized === 'search complete';
}

function parseWebSearchResult(result: string): { links: WebSearchLink[]; summary: string } | null {
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

function renderWebSearchActionExpanded(container: HTMLElement, input: Record<string, unknown>): boolean {
  const data = normalizeWebSearchDisplayData(input);
  const hasStructuredData = Boolean(data.actionType || data.query || data.queries.length || data.url || data.pattern);
  if (!hasStructuredData) {
    return false;
  }

  const linesEl = container.createDiv({ cls: 'pivi-tool-lines' });

  switch (data.actionType) {
    case 'open_page':
      linesEl.createDiv({ cls: 'pivi-tool-line', text: 'Open page' });
      if (data.url) {
        appendToolLink(linesEl, data.url, data.url);
      } else {
        linesEl.createDiv({ cls: 'pivi-tool-line', text: 'URL unavailable' });
      }
      return true;

    case 'find_in_page':
      linesEl.createDiv({ cls: 'pivi-tool-line', text: 'Find in page' });
      if (data.url) {
        appendToolLink(linesEl, data.url, data.url);
      } else {
        linesEl.createDiv({ cls: 'pivi-tool-line', text: 'URL unavailable' });
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

function renderWebSearchExpanded(
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

  container.createDiv({ cls: 'pivi-tool-empty', text: 'No result' });
}

function renderFileSearchExpanded(container: HTMLElement, result: string): void {
  const lines = result.split(/\r?\n/).filter(line => line.trim());
  if (lines.length === 0) {
    container.createDiv({ cls: 'pivi-tool-empty', text: 'No matches found' });
    return;
  }
  renderLinesExpanded(container, result, 15, true);
}

function renderObsidianSearchExpanded(container: HTMLElement, result: string): void {
  const hits = parseObsidianSearchHits(result);
  if (hits.length === 0) {
    renderLinesExpanded(container, result, 12);
    return;
  }
  renderVaultPathLines(
    container,
    hits.map((hit) => ({
      path: hit.path,
      displayPath: hit.line ? `${hit.path}:${hit.line}` : hit.path,
      clickable: true,
    })),
    15,
  );
}

interface ObsidianListEntry {
  path: string;
  kind: 'file' | 'folder';
  name?: string;
  extension?: string;
  size?: number;
}

function parseObsidianListResult(result: string): ObsidianListEntry[] | null {
  try {
    const parsed = JSON.parse(result) as unknown;
    if (!Array.isArray(parsed)) {
      return null;
    }
    const entries: ObsidianListEntry[] = [];
    for (const item of parsed) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        return null;
      }
      const record = item as Record<string, unknown>;
      if (typeof record.path !== 'string' || (record.kind !== 'file' && record.kind !== 'folder')) {
        return null;
      }
      entries.push({
        path: record.path,
        kind: record.kind,
        name: typeof record.name === 'string' ? record.name : undefined,
        extension: typeof record.extension === 'string' ? record.extension : undefined,
        size: typeof record.size === 'number' ? record.size : undefined,
      });
    }
    return entries;
  } catch {
    return null;
  }
}

function renderObsidianListExpanded(container: HTMLElement, result: string, input: Record<string, unknown>): void {
  const entries = parseObsidianListResult(result);
  if (!entries) {
    renderLinesExpanded(container, result, 12);
    return;
  }

  const path = typeof input.path === 'string' && input.path.trim() ? input.path.trim() : 'Vault root';
  if (entries.length === 0) {
    container.createDiv({ cls: 'pivi-tool-empty', text: `${path} is empty` });
    return;
  }

  renderVaultPathLines(
    container,
    entries.map((entry) => ({
      path: entry.path,
      displayPath: entry.kind === 'folder' && !entry.path.endsWith('/')
        ? `${entry.path}/`
        : entry.path,
      clickable: entry.kind === 'file',
    })),
    20,
  );
}

interface VaultPathLine {
  path: string;
  displayPath?: string;
  clickable?: boolean;
}

function renderVaultPathLines(
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

function appendVaultPath(
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

function syncObsidianToolHeader(toolEl: HTMLElement, toolCall: ToolCallInfo): void {
  if (!isObsidianAgentTool(toolCall.name)) {
    return;
  }

  toolEl.addClass('pivi-tool-call-obsidian');

  const nameEl = toolEl.querySelector('.pivi-tool-name');
  if (nameEl) {
    nameEl.setText(getObsidianToolDisplayName(toolCall.name) ?? toolCall.name);
  }

  const summaryEl = toolEl.querySelector('.pivi-tool-summary');
  if (summaryEl) {
    summaryEl.setText(getObsidianToolSummary(toolCall.name, toolCall.input, toolCall.result));
  }

  const compact = isObsidianToolCompactResult(toolCall.name, toolCall.result);
  toolEl.toggleClass('pivi-tool-call-compact', compact);
}

function renderLinesExpanded(
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

function renderToolSearchExpanded(container: HTMLElement, result: string): void {
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
    renderLinesExpanded(container, result, 20);
    return;
  }

  for (const name of toolNames) {
    const lineEl = container.createDiv({ cls: 'pivi-tool-search-item' });
    const iconEl = lineEl.createSpan({ cls: 'pivi-tool-search-icon' });
    setToolIcon(iconEl, name);
    lineEl.createSpan({ text: name });
  }
}

function renderWebFetchExpanded(container: HTMLElement, result: string): void {
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

function renderApplyPatchExpanded(
  container: HTMLElement,
  input: Record<string, unknown>,
  result: string | undefined,
): void {
  const patchText = typeof input.patch === 'string' ? input.patch : '';
  const parsedDiffs = getApplyPatchFileDiffs(input);

  if (result && /verification failed|^[Ee]rror:/.test(result.trim())) {
    renderLinesExpanded(container, result, 20);
  }

  if (parsedDiffs.length > 0) {
    renderApplyPatchDiffSections(container, parsedDiffs);
    return;
  }

  const changes = Array.isArray(input.changes) ? input.changes : [];
  if (changes.length > 0) {
    const linesEl = container.createDiv({ cls: 'pivi-tool-lines' });
    for (const change of changes as unknown[]) {
      if (!change || typeof change !== 'object' || Array.isArray(change)) continue;
      const changeRecord = change as Record<string, unknown>;
      const path = typeof changeRecord.path === 'string' ? changeRecord.path : '';
      if (!path) continue;
      const movedTo = readMoveTarget(changeRecord.kind);
      const pathText = movedTo ? `${path} -> ${movedTo}` : path;
      linesEl.createDiv({ cls: 'pivi-tool-line', text: pathText });
    }
    return;
  }

  if (patchText) {
    renderLinesExpanded(container, patchText, 80);
    return;
  }

  if (result) {
    const fileMatches = [...result.matchAll(/(?:update|add|delete|create|modify|Applied:\s*)(?:\w+:\s*)?([^\n,]+)/gi)];
    if (fileMatches.length > 0) {
      const linesEl = container.createDiv({ cls: 'pivi-tool-lines' });
      for (const match of fileMatches) {
        const filePath = match[1]?.trim();
        if (filePath) {
          const lineEl = linesEl.createDiv({ cls: 'pivi-tool-line' });
          lineEl.setText(filePath);
        }
      }
      return;
    }
    renderLinesExpanded(container, result, 20);
    return;
  }

  container.createDiv({ cls: 'pivi-tool-empty', text: 'No result' });
}

function renderApplyPatchDiffSections(
  container: HTMLElement,
  fileDiffs: ReturnType<typeof parseApplyPatchDiffs>,
): void {
  for (const fileDiff of fileDiffs) {
    const sectionEl = container.createDiv({ cls: 'pivi-tool-patch-section' });

    if (fileDiff.operation === 'delete' && fileDiff.diffLines.length === 0) {
      sectionEl.createDiv({ cls: 'pivi-tool-empty', text: 'File deleted' });
      continue;
    }

    if (fileDiff.diffLines.length === 0) {
      sectionEl.createDiv({ cls: 'pivi-tool-empty', text: 'No textual diff available' });
      continue;
    }

    const diffRow = sectionEl.createDiv({ cls: 'pivi-write-edit-diff-row' });
    const diffEl = diffRow.createDiv({ cls: 'pivi-write-edit-diff' });
    renderDiffContent(diffEl, fileDiff.diffLines);
  }
}

function readMoveTarget(kind: unknown): string | undefined {
  if (!kind || typeof kind !== 'object' || Array.isArray(kind)) {
    return undefined;
  }
  const record = kind as Record<string, unknown>;
  return typeof record.move_path === 'string' ? record.move_path : undefined;
}

function getApplyPatchFileDiffs(input: Record<string, unknown>): ReturnType<typeof parseApplyPatchDiffs> {
  const patchText = typeof input.patch === 'string' ? input.patch : '';
  const parsedDiffs = patchText ? parseApplyPatchDiffs(patchText) : [];
  return parsedDiffs.length > 0 ? parsedDiffs : parseFileUpdateChangeDiffs(input.changes);
}

function getApplyPatchDiffStats(input: Record<string, unknown>): DiffStats | undefined {
  const fileDiffs = getApplyPatchFileDiffs(input);
  if (fileDiffs.length === 0) return undefined;

  const stats = fileDiffs.reduce<DiffStats>(
    (acc, fileDiff) => ({
      added: acc.added + fileDiff.stats.added,
      removed: acc.removed + fileDiff.stats.removed,
    }),
    { added: 0, removed: 0 }
  );

  return stats.added > 0 || stats.removed > 0 ? stats : undefined;
}

function getDiffStatsAriaLabel(stats: DiffStats): string {
  return `Changes: +${stats.added} -${stats.removed}`;
}

function renderAgentLifecycleExpanded(container: HTMLElement, result: string): void {
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
  renderLinesExpanded(container, result, 20);
}

function formatToolDisplayValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return `${value}`;
  }
  if (value === null || value === undefined) {
    return '';
  }
  return JSON.stringify(value);
}

export function renderExpandedContent(
  container: HTMLElement,
  toolName: string,
  result: string | undefined,
  input: Record<string, unknown> = {},
): void {
  if (!result && toolName !== TOOL_WEB_SEARCH && toolName !== TOOL_BASH && toolName !== TOOL_APPLY_PATCH) {
    container.createDiv({ cls: 'pivi-tool-empty', text: 'No result' });
    return;
  }

  const resolvedResult = result ?? '';

  if (isAgentLifecycleTool(toolName)) {
    renderAgentLifecycleExpanded(container, resolvedResult);
    return;
  }

  switch (toolName) {
    case TOOL_BASH:
      renderBashContent(container, input, resolvedResult);
      break;
    case TOOL_WRITE_STDIN:
      renderLinesExpanded(container, resolvedResult, 20);
      break;
    case TOOL_READ:
      renderLinesExpanded(container, resolvedResult, 15);
      break;
    case TOOL_GLOB:
    case TOOL_GREP:
    case TOOL_LS:
      renderFileSearchExpanded(container, resolvedResult);
      break;
    case TOOL_WEB_SEARCH:
      renderWebSearchExpanded(container, input, result);
      break;
    case TOOL_WEB_FETCH:
      renderWebFetchExpanded(container, resolvedResult);
      break;
    case TOOL_TOOL_SEARCH:
      renderToolSearchExpanded(container, resolvedResult);
      break;
    case TOOL_APPLY_PATCH:
      renderApplyPatchExpanded(container, input, result);
      break;
    case TOOL_OBSIDIAN_LIST:
      renderObsidianListExpanded(container, resolvedResult, input);
      break;
    case TOOL_OBSIDIAN_SEARCH:
      renderObsidianSearchExpanded(container, resolvedResult);
      break;
    default:
      renderLinesExpanded(container, resolvedResult, 12);
      break;
  }
}

function getTodos(input: Record<string, unknown>): TodoItem[] | undefined {
  const todos = input.todos;
  if (!todos || !Array.isArray(todos)) return undefined;
  return todos as TodoItem[];
}

function getCurrentTask(input: Record<string, unknown>): TodoItem | undefined {
  const todos = getTodos(input);
  if (!todos) return undefined;
  return todos.find(t => t.status === 'in_progress');
}

function areAllTodosCompleted(input: Record<string, unknown>): boolean {
  const todos = getTodos(input);
  if (!todos || todos.length === 0) return false;
  return todos.every(t => t.status === 'completed');
}

function resetStatusElement(statusEl: HTMLElement, statusClass: string, ariaLabel: string): void {
  statusEl.className = 'pivi-tool-status';
  statusEl.empty();
  statusEl.addClass(statusClass);
  statusEl.setAttribute('aria-label', ariaLabel);
}

const STATUS_ICONS: Record<string, string> = {
  completed: 'check',
  error: 'x',
  blocked: 'shield-off',
};

function setTodoWriteStatus(statusEl: HTMLElement, input: Record<string, unknown>): void {
  const isComplete = areAllTodosCompleted(input);
  const status = isComplete ? 'completed' : 'running';
  const ariaLabel = isComplete ? 'Status: completed' : 'Status: in progress';
  resetStatusElement(statusEl, `status-${status}`, ariaLabel);
  if (isComplete) setIcon(statusEl, 'check');
}

function setToolStatus(statusEl: HTMLElement, status: ToolCallInfo['status']): void {
  resetStatusElement(statusEl, `status-${status}`, `Status: ${status}`);
  const icon = STATUS_ICONS[status];
  if (icon) setIcon(statusEl, icon);
}

function setApplyPatchHeaderRight(statusEl: HTMLElement, toolCall: ToolCallInfo): void {
  const isError = toolCall.status === 'error' || toolCall.status === 'blocked';
  const stats = isError ? undefined : getApplyPatchDiffStats(toolCall.input);
  if (!stats) {
    setToolStatus(statusEl, toolCall.status);
    return;
  }

  statusEl.className = 'pivi-tool-status pivi-write-edit-stats';
  statusEl.empty();
  statusEl.setAttribute('aria-label', getDiffStatsAriaLabel(stats));
  renderDiffStats(statusEl, stats);
}

function setGenericToolHeaderRight(statusEl: HTMLElement, toolCall: ToolCallInfo): void {
  if (toolCall.name === TOOL_APPLY_PATCH) {
    setApplyPatchHeaderRight(statusEl, toolCall);
    return;
  }

  setToolStatus(statusEl, toolCall.status);
}

export function renderTodoWriteResult(
  container: HTMLElement,
  input: Record<string, unknown>
): void {
  container.empty();
  container.addClass('pivi-todo-panel-content');
  container.addClass('pivi-todo-list-container');

  const todos = input.todos as TodoItem[] | undefined;
  if (!todos || !Array.isArray(todos)) {
    const item = container.createSpan({ cls: 'pivi-tool-result-item' });
    item.setText('Tasks updated');
    return;
  }

  renderTodoItems(container, todos);
}

export function isBlockedToolResult(content: unknown, isError?: boolean): boolean {
  const lower = extractToolResultContent(content, { fallbackIndent: 2 }).toLowerCase();
  if (lower.includes('outside the vault')) return true;
  if (lower.includes('access denied')) return true;
  if (lower.includes('user denied')) return true;
  if (lower.includes('approval')) return true;
  if (isError && lower.includes('deny')) return true;
  return false;
}

interface ToolElementStructure {
  toolEl: HTMLElement;
  header: HTMLElement;
  iconEl: HTMLElement;
  nameEl: HTMLElement;
  summaryEl: HTMLElement;
  statusEl: HTMLElement;
  content: HTMLElement;
  currentTaskEl: HTMLElement | null;
}

function createToolElementStructure(
  parentEl: HTMLElement,
  toolCall: ToolCallInfo
): ToolElementStructure {
  const toolEl = parentEl.createDiv({ cls: 'pivi-tool-call' });
  if (toolCall.name === TOOL_BASH) {
    toolEl.addClass('pivi-tool-call-bash');
  }

  const header = toolEl.createDiv({ cls: 'pivi-tool-header' });
  header.setAttribute('tabindex', '0');
  header.setAttribute('role', 'button');

  const iconEl = header.createSpan({ cls: 'pivi-tool-icon' });
  iconEl.setAttribute('aria-hidden', 'true');
  setToolIcon(iconEl, toolCall.name);

  const nameEl = header.createSpan({ cls: 'pivi-tool-name' });
  nameEl.setText(getToolName(toolCall.name, toolCall.input));

  const summaryEl = header.createSpan({ cls: 'pivi-tool-summary' });
  summaryEl.setText(getToolSummary(toolCall.name, toolCall.input));

  const currentTaskEl = toolCall.name === TOOL_TODO_WRITE
    ? createCurrentTaskPreview(header, toolCall.input)
    : null;

  const statusEl = header.createSpan({ cls: 'pivi-tool-status' });

  const content = toolEl.createDiv({ cls: 'pivi-tool-content' });

  return { toolEl, header, iconEl, nameEl, summaryEl, statusEl, content, currentTaskEl };
}

function formatAnswer(raw: unknown): string {
  if (Array.isArray(raw)) return raw.join(', ');
  if (typeof raw === 'string') return raw;
  return '';
}

function resolveAskUserAnswers(toolCall: ToolCallInfo): Record<string, unknown> | undefined {
  if (toolCall.resolvedAnswers) return toolCall.resolvedAnswers;

  const parsed = extractResolvedAnswersFromResultText(toolCall.result);
  if (parsed) {
    toolCall.resolvedAnswers = parsed;
    return parsed;
  }

  return undefined;
}

function renderAskUserQuestionResult(container: HTMLElement, toolCall: ToolCallInfo): boolean {
  container.empty();
  const questions = toolCall.input.questions as AskUserQuestionItem[] | undefined;
  const answers = resolveAskUserAnswers(toolCall);
  if (!questions || !Array.isArray(questions) || !answers) return false;

  const reviewEl = container.createDiv({ cls: 'pivi-ask-review' });
  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    const answer = formatAnswer(
      (q.id ? answers[q.id] : undefined) ?? answers[q.question]
    );
    const pairEl = reviewEl.createDiv({ cls: 'pivi-ask-review-pair' });
    pairEl.createDiv({ text: `${i + 1}.`, cls: 'pivi-ask-review-num' });
    const bodyEl = pairEl.createDiv({ cls: 'pivi-ask-review-body' });
    bodyEl.createDiv({ text: q.question, cls: 'pivi-ask-review-q-text' });
    bodyEl.createDiv({
      text: answer || 'Not answered',
      cls: answer ? 'pivi-ask-review-a-text' : 'pivi-ask-review-empty',
    });
  }

  return true;
}

function renderAskUserQuestionFallback(container: HTMLElement, toolCall: ToolCallInfo, initialText?: string): void {
  container.empty();

  const questions = Array.isArray(toolCall.input.questions)
    ? toolCall.input.questions as AskUserQuestionItem[]
    : [];

  if (questions.length === 0) {
    contentFallback(container, initialText || toolCall.result || 'Waiting for answer...');
    return;
  }

  if (initialText || toolCall.result) {
    container.createDiv({
      cls: 'pivi-ask-review-prompt',
      text: initialText || toolCall.result || 'Waiting for answer...',
    });
  }

  for (let questionIndex = 0; questionIndex < questions.length; questionIndex++) {
    const question = questions[questionIndex];
    const reviewEl = container.createDiv({ cls: 'pivi-ask-review' });
    const pairEl = reviewEl.createDiv({ cls: 'pivi-ask-review-pair' });
    pairEl.createDiv({ text: `${questionIndex + 1}.`, cls: 'pivi-ask-review-num' });
    const bodyEl = pairEl.createDiv({ cls: 'pivi-ask-review-body' });
    bodyEl.createDiv({ text: question.question, cls: 'pivi-ask-review-q-text' });

    if (!Array.isArray(question.options) || question.options.length === 0) {
      bodyEl.createDiv({ cls: 'pivi-ask-review-empty', text: 'No options recorded' });
      continue;
    }

    const listEl = bodyEl.createDiv({ cls: 'pivi-ask-list' });
    question.options.forEach((option, optionIndex) => {
      renderAskUserQuestionOption(listEl, option, optionIndex, question.multiSelect === true);
    });
  }
}

function renderAskUserQuestionOption(
  parentEl: HTMLElement,
  option: AskUserQuestionOption,
  optionIndex: number,
  isMultiSelect: boolean,
): void {
  const itemEl = parentEl.createDiv({ cls: 'pivi-ask-item is-disabled' });

  if (isMultiSelect) {
    itemEl.createDiv({ cls: 'pivi-ask-check', text: '[ ] ' });
  } else {
    itemEl.createDiv({ cls: 'pivi-ask-item-num', text: `${optionIndex + 1}. ` });
  }

  const contentEl = itemEl.createDiv({ cls: 'pivi-ask-item-content' });
  const labelRowEl = contentEl.createDiv({ cls: 'pivi-ask-label-row' });
  labelRowEl.createDiv({ cls: 'pivi-ask-item-label', text: option.label });

  if (option.description) {
    contentEl.createDiv({ cls: 'pivi-ask-item-desc', text: option.description });
  }
}

function contentFallback(container: HTMLElement, text: string): void {
  const resultRow = container.createDiv({ cls: 'pivi-tool-result-row' });
  const resultText = resultRow.createSpan({ cls: 'pivi-tool-result-text' });
  resultText.setText(text);
}

function renderBashContent(
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
    renderLinesExpanded(container, result, 20);
  } else {
    container.createDiv({ cls: 'pivi-tool-empty', text: 'No result' });
  }
}

function createCurrentTaskPreview(
  header: HTMLElement,
  input: Record<string, unknown>
): HTMLElement {
  const currentTaskEl = header.createSpan({ cls: 'pivi-tool-current' });
  const currentTask = getCurrentTask(input);
  if (currentTask) {
    currentTaskEl.setText(currentTask.activeForm ?? currentTask.content);
  }
  return currentTaskEl;
}

function createTodoToggleHandler(
  currentTaskEl: HTMLElement | null,
  statusEl: HTMLElement | null,
  onExpandChange?: (expanded: boolean) => void
): (expanded: boolean) => void {
  return (expanded: boolean) => {
    if (onExpandChange) onExpandChange(expanded);
    if (currentTaskEl) {
      currentTaskEl.toggleClass('pivi-hidden', expanded);
    }
    if (statusEl) {
      statusEl.toggleClass('pivi-hidden', expanded);
    }
  };
}

function renderToolContent(
  content: HTMLElement,
  toolCall: ToolCallInfo,
  initialText?: string
): void {
  if (toolCall.name === TOOL_TODO_WRITE) {
    content.addClass('pivi-tool-content-todo');
    renderTodoWriteResult(content, toolCall.input);
  } else if (toolCall.name === TOOL_ASK_USER_QUESTION) {
    content.addClass('pivi-tool-content-ask');
    if (initialText) {
      renderAskUserQuestionFallback(content, toolCall, 'Waiting for answer...');
    } else if (!renderAskUserQuestionResult(content, toolCall)) {
      renderAskUserQuestionFallback(content, toolCall);
    }
  } else if (toolCall.name === TOOL_BASH) {
    renderBashContent(content, toolCall.input, toolCall.result ?? '', initialText);
  } else if (initialText) {
    contentFallback(content, initialText);
  } else {
    renderExpandedContent(content, toolCall.name, toolCall.result, toolCall.input);
  }
}

export function renderToolCall(
  parentEl: HTMLElement,
  toolCall: ToolCallInfo,
  toolCallElements: Map<string, HTMLElement>
): HTMLElement {
  const { toolEl, header, statusEl, content, currentTaskEl } =
    createToolElementStructure(parentEl, toolCall);

  toolEl.dataset.toolId = toolCall.id;
  toolCallElements.set(toolCall.id, toolEl);

  setGenericToolHeaderRight(statusEl, toolCall);

  renderToolContent(content, toolCall, 'Running...');

  const state = { isExpanded: false };
  toolCall.isExpanded = false;
  const todoStatusEl = toolCall.name === TOOL_TODO_WRITE ? statusEl : null;
  setupCollapsible(toolEl, header, content, state, {
    initiallyExpanded: false,
    onToggle: createTodoToggleHandler(currentTaskEl, todoStatusEl, (expanded) => {
      toolCall.isExpanded = expanded;
    }),
    baseAriaLabel: getToolLabel(toolCall.name, toolCall.input)
  });

  syncObsidianToolHeader(toolEl, toolCall);

  return toolEl;
}

export function updateToolCallResult(
  toolId: string,
  toolCall: ToolCallInfo,
  toolCallElements: Map<string, HTMLElement>
) {
  const toolEl = toolCallElements.get(toolId);
  if (!toolEl) return;

  if (toolCall.name === TOOL_TODO_WRITE) {
    const statusEl = toolEl.querySelector('.pivi-tool-status') as HTMLElement;
    if (statusEl) {
      setTodoWriteStatus(statusEl, toolCall.input);
    }
    const content = toolEl.querySelector('.pivi-tool-content') as HTMLElement;
    if (content) {
      renderTodoWriteResult(content, toolCall.input);
    }
    const nameEl = toolEl.querySelector('.pivi-tool-name') as HTMLElement;
    if (nameEl) {
      nameEl.setText(getToolName(toolCall.name, toolCall.input));
    }
    const currentTaskEl = toolEl.querySelector('.pivi-tool-current') as HTMLElement;
    if (currentTaskEl) {
      const currentTask = getCurrentTask(toolCall.input);
      currentTaskEl.setText(currentTask ? (currentTask.activeForm ?? currentTask.content) : '');
    }
    return;
  }

  const statusEl = toolEl.querySelector('.pivi-tool-status') as HTMLElement;
  if (statusEl) {
    setGenericToolHeaderRight(statusEl, toolCall);
  }

  if (toolCall.name === TOOL_ASK_USER_QUESTION) {
    const content = toolEl.querySelector('.pivi-tool-content') as HTMLElement;
    if (content) {
      content.addClass('pivi-tool-content-ask');
      if (!renderAskUserQuestionResult(content, toolCall)) {
        renderAskUserQuestionFallback(content, toolCall);
      }
    }
    return;
  }

  const content = toolEl.querySelector('.pivi-tool-content') as HTMLElement;
  if (content) {
    content.empty();
    renderExpandedContent(content, toolCall.name, toolCall.result, toolCall.input);
  }

  syncObsidianToolHeader(toolEl, toolCall);
}

/** For stored (non-streaming) tool calls — collapsed by default. */
export function renderStoredToolCall(
  parentEl: HTMLElement,
  toolCall: ToolCallInfo
): HTMLElement {
  const { toolEl, header, statusEl, content, currentTaskEl } =
    createToolElementStructure(parentEl, toolCall);

  if (toolCall.name === TOOL_TODO_WRITE) {
    setTodoWriteStatus(statusEl, toolCall.input);
  } else {
    setGenericToolHeaderRight(statusEl, toolCall);
  }

  renderToolContent(content, toolCall);

  const state = { isExpanded: false };
  const todoStatusEl = toolCall.name === TOOL_TODO_WRITE ? statusEl : null;
  setupCollapsible(toolEl, header, content, state, {
    initiallyExpanded: false,
    onToggle: createTodoToggleHandler(currentTaskEl, todoStatusEl),
    baseAriaLabel: getToolLabel(toolCall.name, toolCall.input)
  });

  syncObsidianToolHeader(toolEl, toolCall);

  return toolEl;
}

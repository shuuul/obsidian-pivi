import type { ToolCallInfo } from '@pivi/pivi-agent-core/foundation';
import {
  TOOL_OBSIDIAN_ATTACHMENT,
  TOOL_OBSIDIAN_COMMAND,
  TOOL_OBSIDIAN_DELETE,
  TOOL_OBSIDIAN_GENERATE_IMAGE,
  TOOL_OBSIDIAN_LINKS,
  TOOL_OBSIDIAN_LIST,
  TOOL_OBSIDIAN_LIST_EXTERNAL,
  TOOL_OBSIDIAN_MKDIR,
  TOOL_OBSIDIAN_MOVE,
  TOOL_OBSIDIAN_NOTE_INFO,
  TOOL_OBSIDIAN_OPEN,
  TOOL_OBSIDIAN_PROPERTIES,
  TOOL_OBSIDIAN_READ,
  TOOL_OBSIDIAN_READ_EXTERNAL,
  TOOL_OBSIDIAN_SEARCH,
  TOOL_OBSIDIAN_TASKS,
  TOOL_OBSIDIAN_WRITE,
} from '@pivi/pivi-agent-core/tools/obsidianToolNames';
import { TOOL_APPLY_PATCH, TOOL_BASH, TOOL_WEB_SEARCH } from '@pivi/pivi-agent-core/tools/toolNames';
import {
  getToolPresentationDescriptor,
  parseObsidianSearchHits,
} from '@pivi/pivi-agent-core/tools/toolPresentation';

import { isObsidianToolCompactResult } from './obsidianToolResultPresentation';
import {
  appendVaultPath,
  formatToolDisplayValue,
  inputString,
  parseJsonArray,
  parseJsonRecord,
  renderKeyValueLines,
  renderLinesExpanded,
  renderVaultPathLines,
  stringField,
} from './toolCallExpandedShared';
import { getToolName, getToolSummary } from './toolPresentationI18n';

export function renderObsidianSearchExpanded(container: HTMLElement, result: string): void {
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

export interface ObsidianListEntry {
  path: string;
  kind: 'file' | 'folder';
  name?: string;
  extension?: string;
  size?: number;
}

export function parseObsidianListResult(result: string): ObsidianListEntry[] | null {
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

export function renderObsidianListExpanded(
  container: HTMLElement,
  result: string,
  input: Record<string, unknown>,
  options: { external?: boolean } = {},
): void {
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
      clickable: !options.external && entry.kind === 'file',
    })),
    20,
  );
}
export function renderObsidianReadExpanded(
  container: HTMLElement,
  result: string,
  input: Record<string, unknown>,
  options: { external?: boolean } = {},
): void {
  const target = inputString(input, 'path') || inputString(input, 'file');
  if (target) {
    const linesEl = container.createDiv({ cls: 'pivi-tool-lines' });
    const lineEl = linesEl.createDiv({ cls: 'pivi-tool-line pivi-tool-line-path hoverable' });
    appendVaultPath(lineEl, target, target, !options.external && target.endsWith('.md'));
  }
  renderLinesExpanded(container, result, 30);
}

export function renderObsidianWriteExpanded(container: HTMLElement, result: string, input: Record<string, unknown>): void {
  const mode = inputString(input, 'mode') || 'write';
  const target = inputString(input, 'path') || inputString(input, 'file');
  const content = inputString(input, 'content');
  renderKeyValueLines(container, [
    ['mode', mode],
    ['path', target],
    ['result', result],
  ], 4);
  if (content) {
    renderLinesExpanded(container, content, 20);
  }
}

export function renderObsidianNoteInfoExpanded(container: HTMLElement, result: string): void {
  const info = parseJsonRecord(result);
  if (!info) {
    renderLinesExpanded(container, result, 20);
    return;
  }

  const frontmatter = info.frontmatter && typeof info.frontmatter === 'object' && !Array.isArray(info.frontmatter)
    ? Object.entries(info.frontmatter as Record<string, unknown>).map(([key, value]) => `${key}=${formatToolDisplayValue(value)}`)
    : [];
  renderKeyValueLines(container, [
    ['path', info.path],
    ['size', info.size],
    ['ctime', info.ctime],
    ['mtime', info.mtime],
    ['tags', Array.isArray(info.tags) ? info.tags.join(', ') : info.tags],
    ['links', Array.isArray(info.links) ? info.links.length : undefined],
    ['frontmatter', frontmatter.join(', ')],
  ], 10);
}

export function getPathFromUnknown(value: unknown): string {
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return '';
  const record = value as Record<string, unknown>;
  return stringField(record, 'path') || stringField(record, 'link') || stringField(record, 'file');
}

export function toUnknownList(value: unknown): unknown[] {
  return Array.isArray(value) ? Array.from(value as readonly unknown[]) : [value];
}

export function renderObsidianLinksExpanded(container: HTMLElement, result: string): void {
  const parsed = parseJsonArray(result) ?? parseJsonRecord(result);
  if (Array.isArray(parsed)) {
    const paths = parsed.map(getPathFromUnknown).filter(Boolean);
    if (paths.length > 0) {
      renderVaultPathLines(container, paths.map(path => ({ path, clickable: path.endsWith('.md') })), 20);
      return;
    }
  } else if (parsed) {
    const candidates = Object.values(parsed).flatMap(toUnknownList);
    const paths = candidates.map(getPathFromUnknown).filter(Boolean);
    if (paths.length > 0) {
      renderVaultPathLines(container, paths.map(path => ({ path, clickable: path.endsWith('.md') })), 20);
      return;
    }
    renderKeyValueLines(container, Object.entries(parsed), 12);
    return;
  }
  renderLinesExpanded(container, result, 20);
}

export function renderObsidianPropertiesExpanded(container: HTMLElement, result: string, input: Record<string, unknown>): void {
  const parsed = parseJsonRecord(result);
  if (parsed) {
    renderKeyValueLines(container, Object.entries(parsed), 20);
    return;
  }

  renderKeyValueLines(container, [
    ['action', inputString(input, 'action')],
    ['property', inputString(input, 'name')],
    ['path', inputString(input, 'path') || inputString(input, 'file')],
    ['result', result],
  ], 6);
}

export function renderObsidianTasksExpanded(container: HTMLElement, result: string, input: Record<string, unknown>): void {
  const action = inputString(input, 'action');
  const tasks = parseJsonArray(result);
  if (tasks && tasks.length > 0) {
    const linesEl = container.createDiv({ cls: 'pivi-tool-lines' });
    for (const task of tasks.slice(0, 20)) {
      const record = task && typeof task === 'object' && !Array.isArray(task) ? task as Record<string, unknown> : null;
      const path = record ? stringField(record, 'path') : '';
      const line = record ? stringField(record, 'line') : '';
      const text = record ? stringField(record, 'text') || stringField(record, 'task') || formatToolDisplayValue(record) : formatToolDisplayValue(task);
      const prefix = path ? `${path}${line ? `:${line}` : ''}` : action || 'task';
      linesEl.createDiv({ cls: 'pivi-tool-line pivi-tool-line-wrap', text: `${prefix} — ${text}` });
    }
    if (tasks.length > 20) {
      linesEl.createDiv({ cls: 'pivi-tool-truncated', text: `... ${tasks.length - 20} more tasks` });
    }
    return;
  }

  renderKeyValueLines(container, [
    ['action', action],
    ['target', inputString(input, 'ref') || inputString(input, 'path') || inputString(input, 'file')],
    ['result', result],
  ], 6);
}

export function renderObsidianPathActionExpanded(container: HTMLElement, result: string, input: Record<string, unknown>): void {
  const target = inputString(input, 'path') || inputString(input, 'file');
  const newPath = inputString(input, 'newPath');
  renderKeyValueLines(container, [
    ['path', target],
    ['newPath', newPath],
    ['result', result],
  ], 6);
}

export function renderObsidianAttachmentExpanded(container: HTMLElement, result: string, input: Record<string, unknown>): void {
  const parsed = parseJsonRecord(result);
  if (parsed) {
    renderKeyValueLines(container, Object.entries(parsed), 12);
    return;
  }
  renderKeyValueLines(container, [
    ['path', inputString(input, 'path')],
    ['filename', inputString(input, 'filename')],
    ['sourcePath', inputString(input, 'sourcePath')],
    ['result', result],
  ], 8);
}

export function renderObsidianGenerateImageExpanded(
  container: HTMLElement,
  result: string,
  details: Record<string, unknown> | undefined,
): void {
  const resourcePath = typeof details?.resourcePath === 'string' ? details.resourcePath : undefined;
  if (resourcePath) {
    const previewEl = container.createDiv({ cls: 'pivi-tool-image-preview' });
    const imageEl = previewEl.createEl('img', { attr: { src: resourcePath, alt: 'Generated image preview' } });
    imageEl.setAttribute('loading', 'lazy');
  }

  renderKeyValueLines(container, [
    ['path', typeof details?.path === 'string' ? details.path : undefined],
    ['markdown', typeof details?.markdown === 'string' ? details.markdown : undefined],
    ['model', typeof details?.model === 'string' ? details.model : undefined],
    ['result', result],
  ], 8);
}

export function renderObsidianExpandedContent(
  container: HTMLElement,
  toolName: string,
  result: string,
  input: Record<string, unknown>,
  details?: Record<string, unknown>,
): void {
  switch (toolName) {
    case TOOL_OBSIDIAN_READ:
      renderObsidianReadExpanded(container, result, input);
      break;
    case TOOL_OBSIDIAN_READ_EXTERNAL:
      renderObsidianReadExpanded(container, result, input, { external: true });
      break;
    case TOOL_OBSIDIAN_WRITE:
      renderObsidianWriteExpanded(container, result, input);
      break;
    case TOOL_OBSIDIAN_NOTE_INFO:
      renderObsidianNoteInfoExpanded(container, result);
      break;
    case TOOL_OBSIDIAN_LINKS:
      renderObsidianLinksExpanded(container, result);
      break;
    case TOOL_OBSIDIAN_PROPERTIES:
      renderObsidianPropertiesExpanded(container, result, input);
      break;
    case TOOL_OBSIDIAN_TASKS:
      renderObsidianTasksExpanded(container, result, input);
      break;
    case TOOL_OBSIDIAN_DELETE:
    case TOOL_OBSIDIAN_MOVE:
    case TOOL_OBSIDIAN_MKDIR:
    case TOOL_OBSIDIAN_OPEN:
    case TOOL_OBSIDIAN_COMMAND:
      renderObsidianPathActionExpanded(container, result, input);
      break;
    case TOOL_OBSIDIAN_ATTACHMENT:
      renderObsidianAttachmentExpanded(container, result, input);
      break;
    case TOOL_OBSIDIAN_GENERATE_IMAGE:
      renderObsidianGenerateImageExpanded(container, result, details);
      break;
    case TOOL_OBSIDIAN_LIST:
      renderObsidianListExpanded(container, result, input);
      break;
    case TOOL_OBSIDIAN_LIST_EXTERNAL:
      renderObsidianListExpanded(container, result, input, { external: true });
      break;
    case TOOL_OBSIDIAN_SEARCH:
      renderObsidianSearchExpanded(container, result);
      break;
    default:
      renderLinesExpanded(container, result, 12);
      break;
  }
}

export function canRenderWithoutResult(toolName: string): boolean {
  return toolName === TOOL_WEB_SEARCH
    || toolName === TOOL_BASH
    || toolName === TOOL_APPLY_PATCH
    || toolName === TOOL_OBSIDIAN_WRITE
    || toolName === TOOL_OBSIDIAN_DELETE
    || toolName === TOOL_OBSIDIAN_MOVE
    || toolName === TOOL_OBSIDIAN_MKDIR
    || toolName === TOOL_OBSIDIAN_OPEN
    || toolName === TOOL_OBSIDIAN_COMMAND
    || toolName === TOOL_OBSIDIAN_ATTACHMENT;
}


export function syncObsidianToolHeader(toolEl: HTMLElement, toolCall: ToolCallInfo): void {
  if (getToolPresentationDescriptor(toolCall.name).kind !== 'obsidian') {
    return;
  }

  toolEl.addClass('pivi-tool-call-obsidian');

  const nameEl = toolEl.querySelector('.pivi-tool-name');
  if (nameEl) {
    nameEl.setText(getToolName(toolCall.name, toolCall.input, toolCall.result));
  }

  const summaryEl = toolEl.querySelector('.pivi-tool-summary');
  if (summaryEl) {
    summaryEl.setText(getToolSummary(toolCall.name, toolCall.input, toolCall.result));
  }

  const compact = isObsidianToolCompactResult(toolCall.name, toolCall.result);
  toolEl.toggleClass('pivi-tool-call-compact', compact);
}

import { isAgentLifecycleTool } from '../../../core/tools/toolNames';
import {
  TOOL_APPLY_PATCH,
  TOOL_BASH,
  TOOL_EDIT,
  TOOL_ENTER_PLAN_MODE,
  TOOL_EXIT_PLAN_MODE,
  TOOL_GLOB,
  TOOL_GREP,
  TOOL_LS,
  TOOL_READ,
  TOOL_SKILL,
  TOOL_TODO_WRITE,
  TOOL_TOOL_SEARCH,
  TOOL_WEB_FETCH,
  TOOL_WEB_SEARCH,
  TOOL_WRITE,
  TOOL_WRITE_STDIN,
} from '../../../core/tools/toolNames';
import {
  getObsidianToolDisplayName,
  getObsidianToolSummary,
  isObsidianAgentTool,
} from './obsiusToolDisplay';

function stringifyToolValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value === null || value === undefined) return '';

  try {
    return JSON.stringify(value);
  } catch {
    return '';
  }
}

function getInputText(input: Record<string, unknown>, key: string, fallback = ''): string {
  return stringifyToolValue(input[key]) || fallback;
}

export function getToolName(name: string, input: Record<string, unknown>): string {
  switch (name) {
    case TOOL_TODO_WRITE: {
      const todos = input.todos as Array<{ status: string }> | undefined;
      if (todos && Array.isArray(todos) && todos.length > 0) {
        const completed = todos.filter(t => t.status === 'completed').length;
        return `Tasks ${completed}/${todos.length}`;
      }
      return 'Tasks';
    }
    case TOOL_ENTER_PLAN_MODE:
      return 'Entering plan mode';
    case TOOL_EXIT_PLAN_MODE:
      return 'Plan complete';
    case TOOL_SKILL:
      return getInputText(input, 'name') || 'Skill';
    default: {
      const obsidianName = getObsidianToolDisplayName(name);
      return obsidianName ?? name;
    }
  }
}

export function getToolSummary(name: string, input: Record<string, unknown>): string {
  switch (name) {
    case TOOL_READ:
    case TOOL_WRITE:
    case TOOL_EDIT: {
      const filePath = getInputText(input, 'file_path');
      return fileNameOnly(filePath);
    }
    case TOOL_BASH: {
      const cmd = getInputText(input, 'command');
      return truncateText(cmd, 60);
    }
    case TOOL_GLOB:
    case TOOL_GREP:
      return getInputText(input, 'pattern');
    case TOOL_WEB_SEARCH:
      return getWebSearchSummary(input, 60);
    case TOOL_WEB_FETCH:
      return truncateText(getInputText(input, 'url'), 60);
    case TOOL_LS:
      return fileNameOnly(getInputText(input, 'path', '.'));
    case TOOL_SKILL:
      return truncateText(getInputText(input, 'args'), 60);
    case TOOL_TOOL_SEARCH:
      return truncateText(parseToolSearchQuery(getInputText(input, 'query')), 60);
    case TOOL_TODO_WRITE:
      return '';
    case TOOL_APPLY_PATCH:
      return getApplyPatchSummary(input);
    case TOOL_WRITE_STDIN:
      return getWriteStdinSummary(input);
    default:
      if (isObsidianAgentTool(name)) {
        return getObsidianToolSummary(name, input);
      }
      if (isAgentLifecycleTool(name)) {
        return getAgentLifecycleSummary(name, input);
      }
      return '';
  }
}

/** Combined name+summary for ARIA labels (collapsible regions need a single descriptive phrase). */
export function getToolLabel(name: string, input: Record<string, unknown>): string {
  switch (name) {
    case TOOL_READ:
      return `Read: ${shortenPath(getInputText(input, 'file_path')) || 'file'}`;
    case TOOL_WRITE:
      return `Write: ${shortenPath(getInputText(input, 'file_path')) || 'file'}`;
    case TOOL_EDIT:
      return `Edit: ${shortenPath(getInputText(input, 'file_path')) || 'file'}`;
    case TOOL_BASH: {
      const cmd = getInputText(input, 'command', 'command');
      return `Bash: ${cmd.length > 40 ? cmd.substring(0, 40) + '...' : cmd}`;
    }
    case TOOL_GLOB:
      return `Glob: ${getInputText(input, 'pattern', 'files')}`;
    case TOOL_GREP:
      return `Grep: ${getInputText(input, 'pattern', 'pattern')}`;
    case TOOL_WEB_SEARCH: {
      return getWebSearchLabel(input, 40);
    }
    case TOOL_WEB_FETCH: {
      const url = getInputText(input, 'url', 'url');
      return `WebFetch: ${url.length > 40 ? url.substring(0, 40) + '...' : url}`;
    }
    case TOOL_LS:
      return `LS: ${shortenPath(getInputText(input, 'path')) || '.'}`;
    case TOOL_TODO_WRITE: {
      const todos = input.todos as Array<{ status: string }> | undefined;
      if (todos && Array.isArray(todos)) {
        const completed = todos.filter(t => t.status === 'completed').length;
        return `Tasks (${completed}/${todos.length})`;
      }
      return 'Tasks';
    }
    case TOOL_SKILL: {
      const skillName = getInputText(input, 'skill', 'skill');
      return `Skill: ${skillName}`;
    }
    case TOOL_TOOL_SEARCH: {
      const tools = parseToolSearchQuery(getInputText(input, 'query'));
      return `ToolSearch: ${tools || 'tools'}`;
    }
    case TOOL_ENTER_PLAN_MODE:
      return 'Entering plan mode';
    case TOOL_EXIT_PLAN_MODE:
      return 'Plan complete';
    case TOOL_APPLY_PATCH: {
      const summary = getApplyPatchSummary(input);
      return summary ? `apply_patch: ${summary}` : 'apply_patch';
    }
    case TOOL_WRITE_STDIN: {
      const summary = getWriteStdinSummary(input);
      return summary ? `write_stdin: ${summary}` : 'write_stdin';
    }
    default:
      if (isObsidianAgentTool(name)) {
        const summary = getObsidianToolSummary(name, input);
        const display = getObsidianToolDisplayName(name) ?? name;
        return summary ? `${display}: ${summary}` : display;
      }
      if (isAgentLifecycleTool(name)) {
        const summary = getAgentLifecycleSummary(name, input);
        return summary ? `${name}: ${summary}` : name;
      }
      return name;
  }
}

export function fileNameOnly(filePath: string): string {
  if (!filePath) return '';
  const normalized = filePath.replace(/\\/g, '/');
  return normalized.split('/').pop() ?? normalized;
}

function getApplyPatchSummary(input: Record<string, unknown>): string {
  // Extract file paths from patch text markers
  const patchText = typeof input.patch === 'string' ? input.patch : '';
  const patchFiles = [...patchText.matchAll(/^\*\*\* (?:Add|Update|Delete) File: (.+)$/gm)]
    .map(m => m[1]?.trim() ?? '');

  // Also check changes array
  const changes = input.changes;
  const changeFiles = Array.isArray(changes)
    ? (changes as Array<{ path?: string }>)
        .map(c => c.path)
        .filter((p): p is string => !!p)
    : [];

  const files = [...new Set([...patchFiles, ...changeFiles])];
  if (files.length === 0) return patchText ? 'patch' : '';
  if (files.length === 1) return fileNameOnly(files[0]);
  return `${files.length} files`;
}

function getWriteStdinSummary(input: Record<string, unknown>): string {
  const sessionId = stringifyToolValue(input.session_id ?? input.sessionId);
  const chars = typeof input.chars === 'string' ? input.chars.replace(/\n/g, '\\n') : '';
  if (chars) {
    const preview = chars.length > 24 ? `${chars.slice(0, 24)}...` : chars;
    return sessionId ? `#${sessionId} ${preview}` : preview;
  }
  return sessionId ? `#${sessionId}` : '';
}

function getAgentLifecycleSummary(name: string, input: Record<string, unknown>): string {
  switch (name) {
    case 'spawn_agent': {
      const msg = typeof input.message === 'string' ? input.message : '';
      return msg.length > 50 ? `${msg.slice(0, 50)}...` : msg;
    }
    case 'send_input': {
      const msg = typeof input.message === 'string' ? input.message : '';
      return msg.length > 40 ? `${msg.slice(0, 40)}...` : msg;
    }
    case 'wait': {
      const ids = Array.isArray(input.ids) ? input.ids.length : 0;
      const timeoutMs = typeof input.timeout_ms === 'number' ? input.timeout_ms : undefined;
      const parts: string[] = [];
      if (ids > 0) parts.push(`${ids} agent${ids === 1 ? '' : 's'}`);
      if (timeoutMs !== undefined) parts.push(`${Math.round(timeoutMs / 1000)}s`);
      return parts.join(', ');
    }
    case 'resume_agent':
    case 'close_agent':
      return '';
    default:
      return '';
  }
}

function shortenPath(filePath: string | undefined): string {
  if (!filePath) return '';
  const normalized = filePath.replace(/\\/g, '/');
  const parts = normalized.split('/');
  if (parts.length <= 3) return normalized;
  return '.../' + parts.slice(-2).join('/');
}

function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength) + '...';
}

function parseToolSearchQuery(query: string | undefined): string {
  if (!query) return '';
  const selectPrefix = 'select:';
  const body = query.startsWith(selectPrefix) ? query.slice(selectPrefix.length) : query;
  return body.split(',').map(s => s.trim()).filter(Boolean).join(', ');
}

export interface WebSearchDisplayData {
  actionType: string;
  query: string;
  queries: string[];
  url: string;
  pattern: string;
}

export function normalizeWebSearchDisplayData(input: Record<string, unknown>): WebSearchDisplayData {
  const queries = Array.isArray(input.queries)
    ? input.queries
        .filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
        .map(entry => entry.trim())
    : [];

  const query = typeof input.query === 'string' && input.query.trim()
    ? input.query.trim()
    : queries[0] ?? '';
  const url = typeof input.url === 'string' && input.url.trim() ? input.url.trim() : '';
  const pattern = typeof input.pattern === 'string' && input.pattern.trim() ? input.pattern.trim() : '';

  const explicitActionType = typeof input.actionType === 'string' && input.actionType.trim()
    ? input.actionType.trim()
    : '';
  const actionType = explicitActionType
    || (url && pattern ? 'find_in_page' : url ? 'open_page' : (query || queries.length > 0) ? 'search' : '');

  return { actionType, query, queries, url, pattern };
}

function getWebSearchSummary(input: Record<string, unknown>, maxLength: number): string {
  const data = normalizeWebSearchDisplayData(input);

  switch (data.actionType) {
    case 'open_page':
      return truncateText(`Open ${data.url || 'page'}`, maxLength);
    case 'find_in_page': {
      const target = data.pattern ? `Find "${data.pattern}"` : 'Find in page';
      const suffix = data.url ? ` in ${data.url}` : '';
      return truncateText(target + suffix, maxLength);
    }
    case 'search':
      return truncateText(data.query || data.queries[0] || '', maxLength);
    default:
      return truncateText(data.query || data.url || data.pattern || '', maxLength);
  }
}

function getWebSearchLabel(input: Record<string, unknown>, maxLength: number): string {
  const summary = getWebSearchSummary(input, maxLength);
  return `WebSearch: ${summary || 'search'}`;
}

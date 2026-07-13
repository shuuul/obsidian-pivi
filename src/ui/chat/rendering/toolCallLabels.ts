import { isAgentLifecycleTool } from '@pivi/pivi-agent-core/tools/toolNames';
import {
  TOOL_APPLY_PATCH,
  TOOL_BASH,
  TOOL_EDIT,
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
} from '@pivi/pivi-agent-core/tools/toolNames';

import { t } from '@/app/i18n';

import {
  getObsidianToolDisplayName,
  getObsidianToolSummary,
  isObsidianAgentTool,
} from './piviToolDisplay';

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
        const completed = todos.filter((todo) => todo.status === 'completed').length;
        return t('tools.steps.tasksProgress', { completed, total: todos.length });
      }
      return t('tools.steps.tasks');
    }
    case TOOL_SKILL:
      return getInputText(input, 'name') || t('tools.steps.skill');
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

function getToolStepPhrases(): Record<string, string> {
  return {
    Read: t('tools.steps.readFile'),
    Write: t('tools.steps.writeFile'),
    Edit: t('tools.steps.editFile'),
    Bash: t('tools.steps.runCommand'),
    Grep: t('tools.steps.searchCode'),
    Glob: t('tools.steps.globFiles'),
    LS: t('tools.steps.listDir'),
    WebSearch: t('tools.steps.searchWeb'),
    WebFetch: t('tools.steps.fetchPage'),
    skill: t('tools.steps.runSkill'),
    ToolSearch: t('tools.steps.findTools'),
    apply_patch: t('tools.steps.applyPatch'),
    write_stdin: t('tools.steps.sendInput'),
    Mcp: t('tools.steps.callMcp'),
    ListMcpResources: t('tools.steps.listMcpResources'),
    ReadMcpResource: t('tools.steps.readMcpResource'),
    NotebookEdit: t('tools.steps.editNotebook'),
  };
}

/** Short verb phrase for step list / group summary (does not replace getToolName/getToolSummary). */
export function getToolStepPhrase(name: string, input: Record<string, unknown>): string {
  const base = getToolStepPhrases()[name];
  if (base) {
    const summary = getToolSummary(name, input);
    if (summary) {
      return truncateText(`${base}: ${summary}`, 72);
    }
    return base;
  }
  const obsidianName = getObsidianToolDisplayName(name);
  const label = obsidianName ?? name;
  const summary = getToolSummary(name, input);
  if (summary) {
    return truncateText(`${label}: ${summary}`, 72);
  }
  return label;
}

/** Combined name+summary for ARIA labels (collapsible regions need a single descriptive phrase). */
type ToolLabelBuilder = (name: string, input: Record<string, unknown>) => string;

function labelWithPrefix(prefix: string, value: string, fallback: string, maxLen?: number): string {
  const raw = value || fallback;
  const text = maxLen !== undefined && raw.length > maxLen ? `${raw.substring(0, maxLen)}...` : raw;
  return `${prefix}: ${text}`;
}

function defaultToolLabel(name: string, input: Record<string, unknown>): string {
  const toolName = getToolName(name, input);
  const summary = getToolSummary(name, input);
  return summary ? `${toolName}: ${summary}` : toolName;
}

const TOOL_LABEL_BUILDERS: Partial<Record<string, ToolLabelBuilder>> = {
  [TOOL_READ]: (_name, input) => labelWithPrefix('Read', shortenPath(getInputText(input, 'file_path')), 'file'),
  [TOOL_WRITE]: (_name, input) => labelWithPrefix('Write', shortenPath(getInputText(input, 'file_path')), 'file'),
  [TOOL_EDIT]: (_name, input) => labelWithPrefix('Edit', shortenPath(getInputText(input, 'file_path')), 'file'),
  [TOOL_BASH]: (_name, input) => labelWithPrefix('Bash', getInputText(input, 'command', 'command'), 'command', 40),
  [TOOL_GLOB]: (_name, input) => labelWithPrefix('Glob', getInputText(input, 'pattern', 'files'), 'files'),
  [TOOL_GREP]: (_name, input) => labelWithPrefix('Grep', getInputText(input, 'pattern', 'pattern'), 'pattern'),
  [TOOL_WEB_SEARCH]: (_name, input) => getWebSearchLabel(input, 40),
  [TOOL_WEB_FETCH]: (_name, input) => labelWithPrefix('WebFetch', getInputText(input, 'url', 'url'), 'url', 40),
  [TOOL_LS]: (_name, input) => labelWithPrefix('LS', shortenPath(getInputText(input, 'path')) || '.', '.'),
  [TOOL_TODO_WRITE]: (_name, input) => {
    const todos = input.todos as Array<{ status: string }> | undefined;
    if (todos && Array.isArray(todos)) {
      const completed = todos.filter((todo) => todo.status === 'completed').length;
      return `${t('tools.steps.tasks')} (${completed}/${todos.length})`;
    }
    return t('tools.steps.tasks');
  },
  [TOOL_SKILL]: (_name, input) => labelWithPrefix(t('tools.steps.skill'), getInputText(input, 'name', 'skill'), 'skill'),
  [TOOL_TOOL_SEARCH]: (_name, input) => {
    const tools = parseToolSearchQuery(getInputText(input, 'query'));
    return `ToolSearch: ${tools || 'tools'}`;
  },
  [TOOL_APPLY_PATCH]: (_name, input) => {
    const summary = getApplyPatchSummary(input);
    return summary ? `apply_patch: ${summary}` : 'apply_patch';
  },
  [TOOL_WRITE_STDIN]: (_name, input) => {
    const summary = getWriteStdinSummary(input);
    return summary ? `write_stdin: ${summary}` : 'write_stdin';
  },
};

/** Combined name+summary for ARIA labels (collapsible regions need a single descriptive phrase). */
export function getToolLabel(name: string, input: Record<string, unknown>): string {
  if (name.startsWith('mcp__')) {
    return defaultToolLabel(name, input);
  }

  const builder = TOOL_LABEL_BUILDERS[name];
  if (builder) {
    return builder(name, input);
  }

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
  if (files.length === 1) return fileNameOnly(files[0] ?? '');
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

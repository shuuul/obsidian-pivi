import type { ToolCallInfo } from '@pivi/pivi-agent-core/foundation';
import {
  isObsidianAgentTool,
  TOOL_OBSIDIAN_ATTACHMENT,
  TOOL_OBSIDIAN_BASE,
  TOOL_OBSIDIAN_BASH,
  TOOL_OBSIDIAN_COMMAND,
  TOOL_OBSIDIAN_DAILY,
  TOOL_OBSIDIAN_DELETE,
  TOOL_OBSIDIAN_EDIT,
  TOOL_OBSIDIAN_EVAL,
  TOOL_OBSIDIAN_GENERATE_IMAGE,
  TOOL_OBSIDIAN_GRAPH,
  TOOL_OBSIDIAN_HISTORY,
  TOOL_OBSIDIAN_LINKS,
  TOOL_OBSIDIAN_LIST,
  TOOL_OBSIDIAN_LIST_EXTERNAL,
  TOOL_OBSIDIAN_MARKDOWN_STRUCTURE,
  TOOL_OBSIDIAN_MKDIR,
  TOOL_OBSIDIAN_MOVE,
  TOOL_OBSIDIAN_NOTE_INFO,
  TOOL_OBSIDIAN_OPEN,
  TOOL_OBSIDIAN_PROPERTIES,
  TOOL_OBSIDIAN_READ,
  TOOL_OBSIDIAN_READ_EXTERNAL,
  TOOL_OBSIDIAN_SEARCH,
  TOOL_OBSIDIAN_TAGS,
  TOOL_OBSIDIAN_TASKS,
  TOOL_OBSIDIAN_WRITE,
} from '@pivi/pivi-agent-core/tools/obsidianToolNames';
import {
  isSubagentToolName,
  TOOL_AGENT_OUTPUT,
  TOOL_APPLY_PATCH,
  TOOL_ASK_USER_QUESTION,
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

import type { TFunction, TranslationKey } from '../../i18n/types';

export type ToolPresentationStatus = ToolCallInfo['status'];

export interface ToolSummary {
  readonly summary: string;
  readonly todoProgress: { readonly completed: number; readonly total: number } | null;
}

export type ToolCallRun =
  | { readonly kind: 'single'; readonly toolCall: ToolCallInfo }
  | { readonly kind: 'group'; readonly toolCalls: readonly ToolCallInfo[] };

function stringValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

function truncate(value: string, limit: number): string {
  return value.length > limit ? `${value.slice(0, limit)}...` : value;
}

function fileName(path: string): string {
  const normalized = path.replace(/\\/g, '/');
  return normalized.split('/').pop() ?? normalized;
}

function shortenPath(filePath: string): string {
  if (!filePath) return '';
  const normalized = filePath.replace(/\\/g, '/');
  const parts = normalized.split('/');
  if (parts.length <= 3) return normalized;
  return `.../${parts.slice(-2).join('/')}`;
}

const OBSIDIAN_DISPLAY_KEYS: Readonly<Record<string, TranslationKey>> = {
  [TOOL_OBSIDIAN_READ]: 'tools.display.read',
  [TOOL_OBSIDIAN_READ_EXTERNAL]: 'tools.display.readExternal',
  [TOOL_OBSIDIAN_MARKDOWN_STRUCTURE]: 'tools.display.outline',
  [TOOL_OBSIDIAN_EDIT]: 'tools.display.edit',
  [TOOL_OBSIDIAN_WRITE]: 'tools.display.write',
  [TOOL_OBSIDIAN_SEARCH]: 'tools.display.search',
  [TOOL_OBSIDIAN_NOTE_INFO]: 'tools.display.noteInfo',
  [TOOL_OBSIDIAN_LINKS]: 'tools.display.links',
  [TOOL_OBSIDIAN_PROPERTIES]: 'tools.display.properties',
  [TOOL_OBSIDIAN_TASKS]: 'tools.display.tasks',
  [TOOL_OBSIDIAN_HISTORY]: 'tools.display.history',
  [TOOL_OBSIDIAN_DELETE]: 'tools.display.delete',
  [TOOL_OBSIDIAN_MOVE]: 'tools.display.move',
  [TOOL_OBSIDIAN_LIST]: 'tools.display.list',
  [TOOL_OBSIDIAN_LIST_EXTERNAL]: 'tools.display.listExternal',
  [TOOL_OBSIDIAN_MKDIR]: 'tools.display.mkdir',
  [TOOL_OBSIDIAN_OPEN]: 'tools.display.open',
  [TOOL_OBSIDIAN_ATTACHMENT]: 'tools.display.attachment',
  [TOOL_OBSIDIAN_GENERATE_IMAGE]: 'tools.display.generateImage',
  [TOOL_OBSIDIAN_BASH]: 'tools.display.bash',
  [TOOL_OBSIDIAN_COMMAND]: 'tools.display.command',
  [TOOL_OBSIDIAN_EVAL]: 'tools.display.eval',
  [TOOL_OBSIDIAN_DAILY]: 'tools.display.daily',
  [TOOL_OBSIDIAN_GRAPH]: 'tools.display.graph',
  [TOOL_OBSIDIAN_TAGS]: 'tools.display.tags',
  [TOOL_OBSIDIAN_BASE]: 'tools.display.base',
};

const STEP_PHRASE_KEYS: Readonly<Record<string, TranslationKey>> = {
  [TOOL_READ]: 'tools.steps.readFile',
  [TOOL_WRITE]: 'tools.steps.writeFile',
  [TOOL_EDIT]: 'tools.steps.editFile',
  [TOOL_BASH]: 'tools.steps.runCommand',
  [TOOL_GREP]: 'tools.steps.searchCode',
  [TOOL_GLOB]: 'tools.steps.globFiles',
  [TOOL_LS]: 'tools.steps.listDir',
  [TOOL_WEB_SEARCH]: 'tools.steps.searchWeb',
  [TOOL_WEB_FETCH]: 'tools.steps.fetchPage',
  [TOOL_SKILL]: 'tools.steps.runSkill',
  [TOOL_TOOL_SEARCH]: 'tools.steps.findTools',
  [TOOL_APPLY_PATCH]: 'tools.steps.applyPatch',
  [TOOL_WRITE_STDIN]: 'tools.steps.sendInput',
  Mcp: 'tools.steps.callMcp',
  ListMcpResources: 'tools.steps.listMcpResources',
  ReadMcpResource: 'tools.steps.readMcpResource',
  NotebookEdit: 'tools.steps.editNotebook',
};

function getObsidianToolDisplayName(name: string, t: TFunction): string | null {
  const key = OBSIDIAN_DISPLAY_KEYS[name];
  return key ? t(key) : null;
}

function vaultTarget(input: Record<string, unknown>): string {
  const path = stringValue(input.path).trim();
  if (path) return shortenPath(path);
  const file = stringValue(input.file).trim();
  return file ? truncate(file, 40) : '';
}

function getApplyPatchSummary(input: Record<string, unknown>): string {
  const patchText = typeof input.patch === 'string' ? input.patch : '';
  const patchFiles = [...patchText.matchAll(/^\*\*\* (?:Add|Update|Delete) File: (.+)$/gm)]
    .map(match => match[1]?.trim() ?? '');
  const changes = input.changes;
  const changeFiles = Array.isArray(changes)
    ? (changes as Array<{ path?: string }>)
      .map(change => change.path)
      .filter((path): path is string => !!path)
    : [];
  const files = [...new Set([...patchFiles, ...changeFiles])];
  if (files.length === 0) return patchText ? 'patch' : '';
  if (files.length === 1) return fileName(files[0] ?? '');
  return `${files.length} files`;
}

function getWriteStdinSummary(input: Record<string, unknown>): string {
  const sessionId = stringValue(input.session_id ?? input.sessionId);
  const chars = typeof input.chars === 'string' ? input.chars.replace(/\n/g, '\\n') : '';
  if (chars) {
    const preview = chars.length > 24 ? `${chars.slice(0, 24)}...` : chars;
    return sessionId ? `#${sessionId} ${preview}` : preview;
  }
  return sessionId ? `#${sessionId}` : '';
}

function parseToolSearchQuery(query: string): string {
  if (!query) return '';
  const selectPrefix = 'select:';
  const body = query.startsWith(selectPrefix) ? query.slice(selectPrefix.length) : query;
  return body.split(',').map(part => part.trim()).filter(Boolean).join(', ');
}

function normalizeWebSearchDisplayData(input: Record<string, unknown>): {
  actionType: string;
  query: string;
  queries: string[];
  url: string;
  pattern: string;
} {
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
      return truncate(`Open ${data.url || 'page'}`, maxLength);
    case 'find_in_page': {
      const target = data.pattern ? `Find "${data.pattern}"` : 'Find in page';
      const suffix = data.url ? ` in ${data.url}` : '';
      return truncate(target + suffix, maxLength);
    }
    case 'search':
      return truncate(data.query || data.queries[0] || '', maxLength);
    default:
      return truncate(data.query || data.url || data.pattern || '', maxLength);
  }
}

function getObsidianToolSummary(name: string, input: Record<string, unknown>): string {
  const target = vaultTarget(input);
  switch (name) {
    case TOOL_OBSIDIAN_READ:
    case TOOL_OBSIDIAN_READ_EXTERNAL:
    case TOOL_OBSIDIAN_MARKDOWN_STRUCTURE:
    case TOOL_OBSIDIAN_DELETE:
    case TOOL_OBSIDIAN_LIST:
    case TOOL_OBSIDIAN_LIST_EXTERNAL:
    case TOOL_OBSIDIAN_MKDIR:
    case TOOL_OBSIDIAN_OPEN:
      return target;
    case TOOL_OBSIDIAN_NOTE_INFO:
      return stringValue(input.action).trim() || target;
    case TOOL_OBSIDIAN_SEARCH: {
      const query = stringValue(input.query).trim();
      const parts = [query ? truncate(query, 36) : '', target && !query.startsWith('path:') ? target : '']
        .filter(Boolean);
      return parts.join(' · ');
    }
    case TOOL_OBSIDIAN_LINKS:
      return [stringValue(input.direction).trim() || 'outgoing', target].filter(Boolean).join(' · ');
    case TOOL_OBSIDIAN_PROPERTIES:
      return [stringValue(input.action).trim(), stringValue(input.name).trim(), target].filter(Boolean).join(' · ');
    case TOOL_OBSIDIAN_TASKS:
      return [stringValue(input.action).trim(), target].filter(Boolean).join(' · ');
    case TOOL_OBSIDIAN_HISTORY:
      return [stringValue(input.action).trim(), target || 'vault'].filter(Boolean).join(' · ');
    case TOOL_OBSIDIAN_EDIT:
      return ['edit', target].filter(Boolean).join(' · ');
    case TOOL_OBSIDIAN_WRITE:
      return [stringValue(input.mode).trim(), target].filter(Boolean).join(' · ');
    case TOOL_OBSIDIAN_MOVE: {
      const newPath = stringValue(input.newPath).trim();
      return [target, newPath ? `→ ${shortenPath(newPath)}` : ''].filter(Boolean).join(' ');
    }
    case TOOL_OBSIDIAN_ATTACHMENT:
      return target || truncate(stringValue(input.filename).trim(), 40);
    case TOOL_OBSIDIAN_BASH:
      return truncate(stringValue(input.command).trim(), 48);
    case TOOL_OBSIDIAN_COMMAND:
      return truncate(stringValue(input.id).trim(), 48);
    case TOOL_OBSIDIAN_EVAL:
      return truncate(stringValue(input.code).trim(), 40);
    case TOOL_OBSIDIAN_GENERATE_IMAGE:
      return truncate(stringValue(input.prompt).trim(), 48);
    case TOOL_OBSIDIAN_DAILY:
      return stringValue(input.action).trim() || 'daily';
    case TOOL_OBSIDIAN_GRAPH: {
      const rawActions = input.actions;
      const actions = Array.isArray(rawActions)
        ? rawActions.map(stringValue).map(item => item.trim()).filter(Boolean).join(',')
        : stringValue(input.actions).trim();
      return actions || 'orphans';
    }
    case TOOL_OBSIDIAN_TAGS:
      return [stringValue(input.action).trim(), stringValue(input.name).trim()].filter(Boolean).join(' · ');
    case TOOL_OBSIDIAN_BASE: {
      const view = stringValue(input.view).trim();
      return [
        stringValue(input.action).trim() || 'list',
        target,
        view ? `view: ${truncate(view, 32)}` : '',
      ].filter(Boolean).join(' · ');
    }
    default:
      return target;
  }
}

function getAgentLifecycleSummary(name: string, input: Record<string, unknown>): string {
  switch (name) {
    case 'spawn_agent': {
      const message = typeof input.message === 'string' ? input.message : '';
      return message.length > 50 ? `${message.slice(0, 50)}...` : message;
    }
    case 'send_input': {
      const message = typeof input.message === 'string' ? input.message : '';
      return message.length > 40 ? `${message.slice(0, 40)}...` : message;
    }
    case 'wait': {
      const ids = Array.isArray(input.ids) ? input.ids.length : 0;
      const timeoutMs = typeof input.timeout_ms === 'number' ? input.timeout_ms : undefined;
      const parts: string[] = [];
      if (ids > 0) parts.push(`${ids} agent${ids === 1 ? '' : 's'}`);
      if (timeoutMs !== undefined) parts.push(`${Math.round(timeoutMs / 1000)}s`);
      return parts.join(', ');
    }
    default:
      return '';
  }
}

/** Visible tool header title (raw id / Obsidian display / task progress) — not step phrases. */
export function getToolDisplayName(toolCall: ToolCallInfo, t: TFunction): string {
  switch (toolCall.name) {
    case TOOL_TODO_WRITE: {
      const todos = toolCall.input.todos;
      if (Array.isArray(todos) && todos.length > 0) {
        const completed = todos.filter(todo => {
          if (typeof todo !== 'object' || todo === null) return false;
          return (todo as Record<string, unknown>).status === 'completed';
        }).length;
        return t('tools.steps.tasksProgress', { completed, total: todos.length });
      }
      return t('tools.steps.tasks');
    }
    case TOOL_SKILL:
      return stringValue(toolCall.input.name) || t('tools.steps.skill');
    default: {
      const obsidianName = getObsidianToolDisplayName(toolCall.name, t);
      return obsidianName ?? toolCall.name;
    }
  }
}

export function getToolSummary(toolCall: ToolCallInfo): ToolSummary {
  const input = toolCall.input;
  let summary = '';

  switch (toolCall.name) {
    case TOOL_READ:
    case TOOL_WRITE:
    case TOOL_EDIT:
      summary = fileName(stringValue(input.file_path));
      break;
    case TOOL_BASH:
      summary = truncate(stringValue(input.command), 60);
      break;
    case TOOL_GLOB:
    case TOOL_GREP:
      summary = stringValue(input.pattern);
      break;
    case TOOL_WEB_SEARCH:
      summary = getWebSearchSummary(input, 60);
      break;
    case TOOL_WEB_FETCH:
      summary = truncate(stringValue(input.url), 60);
      break;
    case TOOL_LS:
      summary = fileName(stringValue(input.path) || '.');
      break;
    case TOOL_SKILL:
      summary = truncate(stringValue(input.args), 60);
      break;
    case TOOL_TOOL_SEARCH:
      summary = truncate(parseToolSearchQuery(stringValue(input.query)), 60);
      break;
    case TOOL_TODO_WRITE:
      if (Array.isArray(input.todos)) {
        const completed = input.todos.filter(todo => {
          if (typeof todo !== 'object' || todo === null) return false;
          return (todo as Record<string, unknown>).status === 'completed';
        }).length;
        return { summary: '', todoProgress: { completed, total: input.todos.length } };
      }
      break;
    case TOOL_APPLY_PATCH:
      summary = getApplyPatchSummary(input);
      break;
    case TOOL_WRITE_STDIN:
      summary = getWriteStdinSummary(input);
      break;
    default:
      if (isObsidianAgentTool(toolCall.name)) {
        summary = getObsidianToolSummary(toolCall.name, input);
      } else {
        summary = getAgentLifecycleSummary(toolCall.name, input);
      }
      break;
  }

  return { summary, todoProgress: null };
}

/** Short verb phrase for group header / aria (does not replace display name). */
export function getToolStepPhrase(toolCall: ToolCallInfo, t: TFunction): string {
  const summary = getToolSummary(toolCall).summary;
  const phraseKey = STEP_PHRASE_KEYS[toolCall.name];
  if (phraseKey) {
    const base = t(phraseKey);
    return summary ? truncate(`${base}: ${summary}`, 72) : base;
  }
  const label = getToolDisplayName(toolCall, t);
  return summary ? truncate(`${label}: ${summary}`, 72) : label;
}

export function aggregateToolStatus(toolCalls: readonly ToolCallInfo[]): ToolPresentationStatus {
  if (toolCalls.some(toolCall => toolCall.status === 'running')) return 'running';
  // Group chrome collapses blocked into the error glyph (matches pre-React step groups).
  if (toolCalls.some(toolCall => toolCall.status === 'error' || toolCall.status === 'blocked')) {
    return 'error';
  }
  return 'completed';
}

function isSilentWriteStdinTool(toolCall: ToolCallInfo): boolean {
  return typeof toolCall.input.chars !== 'string' || toolCall.input.chars.length === 0;
}

/**
 * Host-neutral visibility filter for tool rows.
 * Provider-specific lifecycle hidden tools stay filtered by app content adapters.
 */
export function shouldRenderToolCall(toolCall: ToolCallInfo): boolean {
  if (toolCall.name === TOOL_AGENT_OUTPUT) return false;
  if (toolCall.name === TOOL_WRITE_STDIN && isSilentWriteStdinTool(toolCall)) return false;
  if (toolCall.name === 'custom_tool_call_output') return false;
  return true;
}

/** Matches aggregatable visible tools; ask-user, todos, and subagents stay solo. */
export function isGroupableToolCall(toolCall: ToolCallInfo): boolean {
  if (!shouldRenderToolCall(toolCall)) return false;
  if (toolCall.subagent) return false;
  
  if (isSubagentToolName(toolCall.name)) return false;
  if (toolCall.name === TOOL_TODO_WRITE || toolCall.name === TOOL_ASK_USER_QUESTION) return false;
  return true;
}

export function groupToolCallRuns(toolCalls: readonly ToolCallInfo[]): readonly ToolCallRun[] {
  const runs: ToolCallRun[] = [];
  let group: ToolCallInfo[] = [];

  const flush = () => {
    if (group.length === 0) return;
    runs.push({ kind: 'group', toolCalls: group });
    group = [];
  };

  for (const toolCall of toolCalls) {
    if (isGroupableToolCall(toolCall)) {
      group.push(toolCall);
      continue;
    }
    flush();
    runs.push({ kind: 'single', toolCall });
  }
  flush();
  return runs;
}

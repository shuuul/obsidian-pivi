import {
  isObsidianAgentTool,
  TOOL_OBSIDIAN_ATTACHMENT,
  TOOL_OBSIDIAN_BASH,
  TOOL_OBSIDIAN_COMMAND,
  TOOL_OBSIDIAN_DELETE,
  TOOL_OBSIDIAN_EDIT,
  TOOL_OBSIDIAN_EVAL,
  TOOL_OBSIDIAN_GENERATE_IMAGE,
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
  TOOL_OBSIDIAN_TASKS,
  TOOL_OBSIDIAN_WRITE,
} from '@pivi/pivi-agent-core/tools/obsidianToolNames';

import { t } from '@/i18n';

function stringify(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return '';
}

function inputText(input: Record<string, unknown>, key: string): string {
  return stringify(input[key]).trim();
}

function shortenPath(filePath: string): string {
  if (!filePath) {
    return '';
  }
  const normalized = filePath.replace(/\\/g, '/');
  const parts = normalized.split('/');
  if (parts.length <= 3) {
    return normalized;
  }
  return `.../${parts.slice(-2).join('/')}`;
}

function truncate(text: string, max: number): string {
  if (text.length <= max) {
    return text;
  }
  return `${text.slice(0, max)}…`;
}

function vaultTarget(input: Record<string, unknown>): string {
  const path = inputText(input, 'path');
  if (path) {
    return shortenPath(path);
  }
  const file = inputText(input, 'file');
  return file ? truncate(file, 40) : '';
}

/** Human-readable tool title in the chat tool header. */
export function getObsidianToolDisplayName(name: string): string | null {
  switch (name) {
    case TOOL_OBSIDIAN_READ:
      return t('tools.display.read');
    case TOOL_OBSIDIAN_READ_EXTERNAL:
      return t('tools.display.readExternal');
    case TOOL_OBSIDIAN_MARKDOWN_STRUCTURE:
      return t('tools.display.structure');
    case TOOL_OBSIDIAN_EDIT:
      return t('tools.display.edit');
    case TOOL_OBSIDIAN_WRITE:
      return t('tools.display.write');
    case TOOL_OBSIDIAN_SEARCH:
      return t('tools.display.search');
    case TOOL_OBSIDIAN_NOTE_INFO:
      return t('tools.display.noteInfo');
    case TOOL_OBSIDIAN_LINKS:
      return t('tools.display.links');
    case TOOL_OBSIDIAN_PROPERTIES:
      return t('tools.display.properties');
    case TOOL_OBSIDIAN_TASKS:
      return t('tools.display.tasks');
    case TOOL_OBSIDIAN_HISTORY:
      return t('tools.display.history');
    case TOOL_OBSIDIAN_DELETE:
      return t('tools.display.delete');
    case TOOL_OBSIDIAN_MOVE:
      return t('tools.display.move');
    case TOOL_OBSIDIAN_LIST:
      return t('tools.display.list');
    case TOOL_OBSIDIAN_LIST_EXTERNAL:
      return t('tools.display.listExternal');
    case TOOL_OBSIDIAN_MKDIR:
      return t('tools.display.mkdir');
    case TOOL_OBSIDIAN_OPEN:
      return t('tools.display.open');
    case TOOL_OBSIDIAN_ATTACHMENT:
      return t('tools.display.attachment');
    case TOOL_OBSIDIAN_GENERATE_IMAGE:
      return t('tools.display.generateImage');
    case TOOL_OBSIDIAN_BASH:
      return t('tools.display.bash');
    case TOOL_OBSIDIAN_COMMAND:
      return t('tools.display.command');
    case TOOL_OBSIDIAN_EVAL:
      return t('tools.display.eval');
    default:
      return null;
  }
}

export interface ObsidianSearchHitLike {
  path: string;
  line?: number;
}

/** Parse obsidian_search JSON for header / compact body display. */
export function parseObsidianSearchHits(result: string): ObsidianSearchHitLike[] {
  try {
    const parsed = JSON.parse(result) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    const hits: ObsidianSearchHitLike[] = [];
    for (const entry of parsed) {
      if (!entry || typeof entry !== 'object') {
        continue;
      }
      const record = entry as Record<string, unknown>;
      const path = stringify(record.path).trim();
      if (!path) {
        continue;
      }
      const line = typeof record.line === 'number' ? record.line : undefined;
      hits.push(line !== undefined ? { path, line } : { path });
    }
    return hits;
  } catch {
    return [];
  }
}

export function summarizeObsidianSearchHits(hits: ObsidianSearchHitLike[]): string {
  if (hits.length === 0) {
    return '0 matches';
  }
  if (hits.length === 1) {
    const hit = hits[0];
    return hit.line ? `${hit.path}:${hit.line}` : hit.path;
  }
  const paths = hits.map((h) => (h.line ? `${h.path}:${h.line}` : h.path));
  if (paths.length <= 3) {
    return paths.join(', ');
  }
  return `${hits.length} matches`;
}

function parseObsidianListEntries(result: string): unknown[] | null {
  try {
    const parsed = JSON.parse(result) as unknown;
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function summarizeObsidianSearchTool(
  input: Record<string, unknown>,
  target: string,
  result?: string,
): string {
  const query = inputText(input, 'query');
  const parts: string[] = [];
  if (query) {
    parts.push(truncate(query, 36));
  }
  if (target && !query.startsWith('path:')) {
    parts.push(target);
  }
  if (result) {
    const hitLine = summarizeObsidianSearchHits(parseObsidianSearchHits(result));
    if (hitLine) {
      parts.push(hitLine);
    }
  }
  return parts.join(' · ');
}

function summarizePathTool(name: string, input: Record<string, unknown>): string {
  switch (name) {
    case TOOL_OBSIDIAN_EDIT:
      return ['edit', vaultTarget(input)].filter(Boolean).join(' · ');
    case TOOL_OBSIDIAN_WRITE: {
      const mode = inputText(input, 'mode');
      return [mode, vaultTarget(input)].filter(Boolean).join(' · ');
    }
    case TOOL_OBSIDIAN_MOVE: {
      const target = vaultTarget(input);
      const newPath = inputText(input, 'newPath');
      return [target, newPath ? `→ ${shortenPath(newPath)}` : ''].filter(Boolean).join(' ');
    }
    case TOOL_OBSIDIAN_ATTACHMENT: {
      const filename = inputText(input, 'filename');
      return vaultTarget(input) || truncate(filename, 40);
    }
    case TOOL_OBSIDIAN_BASH:
      return truncate(inputText(input, 'command'), 48);
    case TOOL_OBSIDIAN_COMMAND:
      return truncate(inputText(input, 'id'), 48);
    case TOOL_OBSIDIAN_EVAL:
      return truncate(inputText(input, 'code'), 40);
    default:
      return vaultTarget(input);
  }
}

/** One-line summary shown beside the tool name (input + optional result). */
export function getObsidianToolSummary(
  name: string,
  input: Record<string, unknown>,
  result?: string,
): string {
  const target = vaultTarget(input);

  switch (name) {
    case TOOL_OBSIDIAN_READ:
    case TOOL_OBSIDIAN_READ_EXTERNAL:
    case TOOL_OBSIDIAN_NOTE_INFO:
    case TOOL_OBSIDIAN_MARKDOWN_STRUCTURE:
      return target;
    case TOOL_OBSIDIAN_SEARCH:
      return summarizeObsidianSearchTool(input, target, result);
    case TOOL_OBSIDIAN_LINKS: {
      const direction = inputText(input, 'direction') || 'outgoing';
      return [direction, target].filter(Boolean).join(' · ');
    }
    case TOOL_OBSIDIAN_PROPERTIES: {
      const action = inputText(input, 'action');
      const prop = inputText(input, 'name');
      return [action, prop, target].filter(Boolean).join(' · ');
    }
    case TOOL_OBSIDIAN_TASKS: {
      const action = inputText(input, 'action');
      return [action, target].filter(Boolean).join(' · ');
    }
    case TOOL_OBSIDIAN_HISTORY: {
      const action = inputText(input, 'action');
      return [action, target || 'vault'].filter(Boolean).join(' · ');
    }
    case TOOL_OBSIDIAN_DELETE:
      return target;
    case TOOL_OBSIDIAN_LIST:
    case TOOL_OBSIDIAN_LIST_EXTERNAL:
    case TOOL_OBSIDIAN_MKDIR:
    case TOOL_OBSIDIAN_OPEN:
      return target;
    case TOOL_OBSIDIAN_GENERATE_IMAGE:
      return truncate(inputText(input, 'prompt'), 48);
    default:
      return summarizePathTool(name, input);
  }
}

export function isObsidianToolCompactResult(name: string, result?: string): boolean {
  if (!result) {
    return false;
  }

  if (name === TOOL_OBSIDIAN_LIST || name === TOOL_OBSIDIAN_LIST_EXTERNAL) {
    return parseObsidianListEntries(result) !== null;
  }

  if (name !== TOOL_OBSIDIAN_SEARCH) {
    return false;
  }

  const hits = parseObsidianSearchHits(result);
  return hits.length > 0 && hits.length <= 12;
}

export { isObsidianAgentTool };

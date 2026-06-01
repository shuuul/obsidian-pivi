import {
  isObsidianAgentTool,
  TOOL_OBSIDIAN_COMMAND,
  TOOL_OBSIDIAN_EVAL,
  TOOL_OBSIDIAN_LINKS,
  TOOL_OBSIDIAN_NOTE_INFO,
  TOOL_OBSIDIAN_PROPERTIES,
  TOOL_OBSIDIAN_EDIT,
  TOOL_OBSIDIAN_READ,
  TOOL_OBSIDIAN_SEARCH,
  TOOL_OBSIDIAN_TASKS,
  TOOL_OBSIDIAN_WRITE,
} from '../../../core/tools/obsidianToolNames';

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
      return 'Read';
    case TOOL_OBSIDIAN_EDIT:
      return 'Edit';
    case TOOL_OBSIDIAN_WRITE:
      return 'Write';
    case TOOL_OBSIDIAN_SEARCH:
      return 'Search';
    case TOOL_OBSIDIAN_NOTE_INFO:
      return 'Note info';
    case TOOL_OBSIDIAN_LINKS:
      return 'Links';
    case TOOL_OBSIDIAN_PROPERTIES:
      return 'Properties';
    case TOOL_OBSIDIAN_TASKS:
      return 'Tasks';
    case TOOL_OBSIDIAN_COMMAND:
      return 'Command';
    case TOOL_OBSIDIAN_EVAL:
      return 'Eval';
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

/** One-line summary shown beside the tool name (input + optional result). */
export function getObsidianToolSummary(
  name: string,
  input: Record<string, unknown>,
  result?: string,
): string {
  const target = vaultTarget(input);

  switch (name) {
    case TOOL_OBSIDIAN_READ:
    case TOOL_OBSIDIAN_NOTE_INFO:
      return target;
    case TOOL_OBSIDIAN_EDIT:
      return ['edit', target].filter(Boolean).join(' · ');
    case TOOL_OBSIDIAN_WRITE: {
      const mode = inputText(input, 'mode');
      return [mode, target].filter(Boolean).join(' · ');
    }
    case TOOL_OBSIDIAN_SEARCH: {
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
    case TOOL_OBSIDIAN_COMMAND:
      return truncate(inputText(input, 'id'), 48);
    case TOOL_OBSIDIAN_EVAL:
      return truncate(inputText(input, 'code'), 40);
    default:
      return target;
  }
}

export function isObsidianToolCompactResult(name: string, result?: string): boolean {
  if (!result || name !== TOOL_OBSIDIAN_SEARCH) {
    return false;
  }
  const hits = parseObsidianSearchHits(result);
  return hits.length > 0 && hits.length <= 12;
}

export { isObsidianAgentTool };

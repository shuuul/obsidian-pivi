export type ToolSummaryResolver = (
  input: Record<string, unknown>,
  result?: string,
) => string;

function stringValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

export function truncateToolText(value: string, limit: number): string {
  return value.length > limit ? `${value.slice(0, limit)}...` : value;
}

export function toolFileName(path: string): string {
  if (!path) return '';
  const normalized = path.replace(/\\/g, '/');
  return normalized.split('/').pop() ?? normalized;
}

function shortenPath(filePath: string): string {
  if (!filePath) return '';
  const normalized = filePath.replace(/\\/g, '/');
  const parts = normalized.split('/');
  return parts.length <= 3 ? normalized : `.../${parts.slice(-2).join('/')}`;
}

function inputText(input: Record<string, unknown>, key: string): string {
  return stringValue(input[key]).trim();
}

function vaultTarget(input: Record<string, unknown>): string {
  const path = inputText(input, 'path');
  if (path) return shortenPath(path);
  const file = inputText(input, 'file');
  return file ? truncateToolText(file, 40) : '';
}

export const summarizeNone: ToolSummaryResolver = () => '';

export function summarizeInput(key: string, limit?: number): ToolSummaryResolver {
  return (input) => {
    const value = inputText(input, key);
    return limit === undefined ? value : truncateToolText(value, limit);
  };
}

export function summarizeFileInput(key: string, fallback = ''): ToolSummaryResolver {
  return (input) => toolFileName(inputText(input, key) || fallback);
}

export interface WebSearchDisplayData {
  readonly actionType: string;
  readonly query: string;
  readonly queries: readonly string[];
  readonly url: string;
  readonly pattern: string;
}

export function normalizeWebSearchDisplayData(
  input: Record<string, unknown>,
): WebSearchDisplayData {
  const queries = Array.isArray(input.queries)
    ? input.queries
      .filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
      .map(entry => entry.trim())
    : [];
  const query = inputText(input, 'query') || queries[0] || '';
  const url = inputText(input, 'url');
  const pattern = inputText(input, 'pattern');
  const explicitActionType = inputText(input, 'actionType');
  const actionType = explicitActionType
    || (url && pattern
      ? 'find_in_page'
      : url
        ? 'open_page'
        : query || queries.length > 0
          ? 'search'
          : '');
  return { actionType, query, queries, url, pattern };
}

export const summarizeWebSearch: ToolSummaryResolver = (input) => {
  const data = normalizeWebSearchDisplayData(input);
  switch (data.actionType) {
    case 'open_page':
      return truncateToolText(`Open ${data.url || 'page'}`, 60);
    case 'find_in_page': {
      const target = data.pattern ? `Find "${data.pattern}"` : 'Find in page';
      return truncateToolText(`${target}${data.url ? ` in ${data.url}` : ''}`, 60);
    }
    case 'search':
      return truncateToolText(data.query || data.queries[0] || '', 60);
    default:
      return truncateToolText(data.query || data.url || data.pattern, 60);
  }
};

export const summarizeToolSearch: ToolSummaryResolver = (input) => {
  const query = inputText(input, 'query');
  const body = query.startsWith('select:') ? query.slice('select:'.length) : query;
  const names = body.split(',').map(part => part.trim()).filter(Boolean).join(', ');
  return truncateToolText(names, 60);
};

export const summarizeApplyPatch: ToolSummaryResolver = (input) => {
  const patchText = typeof input.patch === 'string' ? input.patch : '';
  const patchFiles = [...patchText.matchAll(/^\*\*\* (?:Add|Update|Delete) File: (.+)$/gm)]
    .map(match => match[1]?.trim() ?? '');
  const changeFiles = Array.isArray(input.changes)
    ? input.changes
      .map(change => change && typeof change === 'object'
        ? stringValue((change as Record<string, unknown>).path)
        : '')
      .filter(Boolean)
    : [];
  const files = [...new Set([...patchFiles, ...changeFiles])];
  if (files.length === 0) return patchText ? 'patch' : '';
  if (files.length === 1) return toolFileName(files[0] ?? '');
  return `${files.length} files`;
};

export const summarizeWriteStdin: ToolSummaryResolver = (input) => {
  const sessionId = stringValue(input.session_id ?? input.sessionId);
  const chars = typeof input.chars === 'string' ? input.chars.replace(/\n/g, '\\n') : '';
  if (!chars) return sessionId ? `#${sessionId}` : '';
  const preview = truncateToolText(chars, 24);
  return sessionId ? `#${sessionId} ${preview}` : preview;
};

export const summarizeSpawnAgent: ToolSummaryResolver = input =>
  truncateToolText(inputText(input, 'message'), 50);

export const summarizeSendInput: ToolSummaryResolver = input =>
  truncateToolText(inputText(input, 'message'), 40);

export const summarizeWait: ToolSummaryResolver = (input) => {
  const ids = Array.isArray(input.ids) ? input.ids.length : 0;
  const timeoutMs = typeof input.timeout_ms === 'number' ? input.timeout_ms : undefined;
  const parts: string[] = [];
  if (ids > 0) parts.push(`${ids} agent${ids === 1 ? '' : 's'}`);
  if (timeoutMs !== undefined) parts.push(`${Math.round(timeoutMs / 1000)}s`);
  return parts.join(', ');
};

export interface ObsidianSearchHitLike {
  readonly path: string;
  readonly line?: number;
}

export function parseObsidianSearchHits(result: string): ObsidianSearchHitLike[] {
  try {
    const parsed = JSON.parse(result) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((entry): ObsidianSearchHitLike[] => {
      if (!entry || typeof entry !== 'object') return [];
      const record = entry as Record<string, unknown>;
      const path = stringValue(record.path).trim();
      if (!path) return [];
      return typeof record.line === 'number'
        ? [{ path, line: record.line }]
        : [{ path }];
    });
  } catch {
    return [];
  }
}

export function summarizeObsidianSearchHits(hits: readonly ObsidianSearchHitLike[]): string {
  if (hits.length === 0) return '0 matches';
  if (hits.length === 1) {
    const hit = hits[0];
    return hit ? (hit.line ? `${hit.path}:${hit.line}` : hit.path) : '0 matches';
  }
  const paths = hits.map(hit => hit.line ? `${hit.path}:${hit.line}` : hit.path);
  return paths.length <= 3 ? paths.join(', ') : `${hits.length} matches`;
}

export const summarizeObsidianTarget: ToolSummaryResolver = input => vaultTarget(input);

export const summarizeObsidianSearch: ToolSummaryResolver = (input, result) => {
  const query = inputText(input, 'query');
  const target = vaultTarget(input);
  const parts = [
    query ? truncateToolText(query, 36) : '',
    target && !query.startsWith('path:') ? target : '',
    result ? summarizeObsidianSearchHits(parseObsidianSearchHits(result)) : '',
  ].filter(Boolean);
  return parts.join(' · ');
};

export const summarizeObsidianNoteInfo: ToolSummaryResolver = input =>
  inputText(input, 'action') || vaultTarget(input);

export const summarizeObsidianLinks: ToolSummaryResolver = input =>
  [inputText(input, 'direction') || 'outgoing', vaultTarget(input)].filter(Boolean).join(' · ');

export const summarizeObsidianProperties: ToolSummaryResolver = input =>
  [inputText(input, 'action'), inputText(input, 'name'), vaultTarget(input)].filter(Boolean).join(' · ');

export const summarizeObsidianActionTarget: ToolSummaryResolver = input =>
  [inputText(input, 'action'), vaultTarget(input)].filter(Boolean).join(' · ');

export const summarizeObsidianHistory: ToolSummaryResolver = input =>
  [inputText(input, 'action'), vaultTarget(input) || 'vault'].filter(Boolean).join(' · ');

export const summarizeObsidianEdit: ToolSummaryResolver = input =>
  ['edit', vaultTarget(input)].filter(Boolean).join(' · ');

export const summarizeObsidianWrite: ToolSummaryResolver = input =>
  [inputText(input, 'mode'), vaultTarget(input)].filter(Boolean).join(' · ');

export const summarizeObsidianMove: ToolSummaryResolver = (input) => {
  const target = vaultTarget(input);
  const newPath = inputText(input, 'newPath');
  return [target, newPath ? `→ ${shortenPath(newPath)}` : ''].filter(Boolean).join(' ');
};

export const summarizeObsidianAttachment: ToolSummaryResolver = input =>
  vaultTarget(input) || truncateToolText(inputText(input, 'filename'), 40);

export const summarizeObsidianDaily: ToolSummaryResolver = input =>
  inputText(input, 'action') || 'daily';

export const summarizeObsidianGraph: ToolSummaryResolver = (input) => {
  const actions = Array.isArray(input.actions)
    ? input.actions.map(stringValue).map(item => item.trim()).filter(Boolean).join(',')
    : inputText(input, 'actions');
  return actions || 'orphans';
};

export const summarizeObsidianTags: ToolSummaryResolver = input =>
  [inputText(input, 'action'), inputText(input, 'name')].filter(Boolean).join(' · ');

export const summarizeObsidianBase: ToolSummaryResolver = (input) => {
  const view = inputText(input, 'view');
  return [
    inputText(input, 'action') || 'list',
    vaultTarget(input),
    view ? `view: ${truncateToolText(view, 32)}` : '',
  ].filter(Boolean).join(' · ');
};

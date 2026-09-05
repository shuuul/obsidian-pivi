/** Live names, silent aliases, and argument shims for the generic file-tool family. */

export const LIVE_GENERIC_TOOLS = [
  'read',
  'write',
  'edit',
  'ls',
  'search',
  'bash',
  'mkdir',
  'move',
  'delete',
] as const;

export type LiveGenericToolName = (typeof LIVE_GENERIC_TOOLS)[number];

const LIVE_GENERIC_TOOL_SET = new Set<string>(LIVE_GENERIC_TOOLS);

/** PascalCase, legacy `obsidian_*`, and extra name aliases → live name. */
export const TOOL_NAME_ALIASES: Readonly<Record<string, LiveGenericToolName>> = {
  Read: 'read',
  obsidian_read: 'read',
  obsidian_read_external: 'read',
  Write: 'write',
  obsidian_write: 'write',
  Edit: 'edit',
  obsidian_edit: 'edit',
  LS: 'ls',
  obsidian_list: 'ls',
  obsidian_list_external: 'ls',
  list_dir: 'ls',
  Search: 'search',
  obsidian_search: 'search',
  Bash: 'bash',
  obsidian_bash: 'bash',
  Mkdir: 'mkdir',
  obsidian_mkdir: 'mkdir',
  Move: 'move',
  obsidian_move: 'move',
  Delete: 'delete',
  obsidian_delete: 'delete',
};

const PATH_FIELD_ALIASES = ['file_path', 'target_file'] as const;

export interface NormalizedToolArguments {
  args: Record<string, unknown>;
  nameAlias?: string;
  fieldAlias?: string;
}

export function isLiveGenericToolName(name: string): name is LiveGenericToolName {
  return LIVE_GENERIC_TOOL_SET.has(name);
}

export function isSilentToolNameAlias(name: string): boolean {
  return Object.prototype.hasOwnProperty.call(TOOL_NAME_ALIASES, name);
}

export function resolveLiveToolName(name: string): string {
  return TOOL_NAME_ALIASES[name] ?? name;
}

export function listSilentNameAliases(liveName: string): string[] {
  return Object.entries(TOOL_NAME_ALIASES)
    .filter(([, live]) => live === liveName)
    .map(([alias]) => alias);
}

export function isDisabledToolName(disabledTools: readonly string[] | undefined, name: string): boolean {
  if (!disabledTools || disabledTools.length === 0) {
    return false;
  }
  const live = resolveLiveToolName(name);
  return disabledTools.some((entry) => resolveLiveToolName(entry) === live);
}

/**
 * Collapse alias spellings onto live names once. `bash` stays gated by
 * `allowBash`, so it is omitted from `disabledTools` the same way `obsidian_bash` was.
 */
export function migrateDisabledToolNames(value: readonly unknown[] | undefined): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const seen = new Set<string>();
  const migrated: string[] = [];
  for (const tool of value) {
    if (typeof tool !== 'string') {
      continue;
    }
    const live = resolveLiveToolName(tool);
    if (live === 'bash' || tool === 'bash') {
      continue;
    }
    if (seen.has(live)) {
      continue;
    }
    seen.add(live);
    migrated.push(live);
  }
  return migrated;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function takeString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === 'string' ? value : undefined;
}

function firstPathAlias(record: Record<string, unknown>): string | undefined {
  for (const alias of PATH_FIELD_ALIASES) {
    if (typeof record[alias] === 'string') {
      return alias;
    }
  }
  return undefined;
}

function applyPathAliases(record: Record<string, unknown>): string | undefined {
  const alias = firstPathAlias(record);
  if (!alias) {
    return undefined;
  }
  if (typeof record.path !== 'string' || record.path.length === 0) {
    record.path = record[alias];
  }
  for (const key of PATH_FIELD_ALIASES) {
    delete record[key];
  }
  return alias;
}

function asPositiveInt(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 ? value : undefined;
}

function normalizeReadPaging(record: Record<string, unknown>): string | undefined {
  const hasStartChar = asPositiveInt(record.startChar) !== undefined;
  if (hasStartChar) {
    return undefined;
  }
  let fieldAlias: string | undefined;
  const startLine = asPositiveInt(record.startLine);
  const endLine = asPositiveInt(record.endLine);
  if (asPositiveInt(record.offset) === undefined && startLine !== undefined) {
    record.offset = startLine;
    fieldAlias = 'startLine';
  }
  if (asPositiveInt(record.limit) === undefined && endLine !== undefined) {
    const start = asPositiveInt(record.offset) ?? startLine ?? 1;
    record.limit = Math.max(1, endLine - start + 1);
    fieldAlias ??= 'endLine';
  }
  if (startLine !== undefined && record.offset !== undefined) {
    delete record.startLine;
  }
  if (endLine !== undefined && record.limit !== undefined) {
    delete record.endLine;
  }
  return fieldAlias;
}

function normalizeSearchQuery(record: Record<string, unknown>): string | undefined {
  if (typeof record.query === 'string') {
    delete record.pattern;
    return undefined;
  }
  const pattern = takeString(record, 'pattern');
  if (pattern === undefined) {
    return undefined;
  }
  record.query = pattern;
  delete record.pattern;
  return 'pattern';
}

function normalizeBashCommand(record: Record<string, unknown>): string | undefined {
  if (typeof record.command === 'string') {
    delete record.cmd;
    return undefined;
  }
  const cmd = takeString(record, 'cmd');
  if (cmd === undefined) {
    return undefined;
  }
  record.command = cmd;
  delete record.cmd;
  return 'cmd';
}

function editItemFromUnknown(value: unknown): { oldText: string; newText: string; replaceAll?: boolean } | null {
  if (typeof value === 'string') {
    return null;
  }
  if (!isPlainObject(value)) {
    return null;
  }
  const oldText = typeof value.oldText === 'string'
    ? value.oldText
    : typeof value.old_string === 'string'
      ? value.old_string
      : undefined;
  const newText = typeof value.newText === 'string'
    ? value.newText
    : typeof value.new_string === 'string'
      ? value.new_string
      : undefined;
  if (oldText === undefined || newText === undefined) {
    return null;
  }
  const replaceAll = value.replaceAll === true || value.replace_all === true;
  return replaceAll ? { oldText, newText, replaceAll: true } : { oldText, newText };
}

function normalizeEdits(record: Record<string, unknown>): string | undefined {
  if (Array.isArray(record.edits)) {
    const items = record.edits
      .map((item) => editItemFromUnknown(item))
      .filter((item): item is { oldText: string; newText: string; replaceAll?: boolean } => item !== null);
    if (items.length > 0) {
      record.edits = items;
    }
    delete record.old_string;
    delete record.new_string;
    delete record.replace_all;
    return undefined;
  }
  if (isPlainObject(record.edits)) {
    const item = editItemFromUnknown(record.edits);
    if (item) {
      record.edits = [item];
      delete record.old_string;
      delete record.new_string;
      delete record.replace_all;
      return undefined;
    }
  }
  if (typeof record.edits === 'string') {
    return undefined;
  }
  const oldString = takeString(record, 'old_string');
  const newString = takeString(record, 'new_string');
  if (oldString === undefined || newString === undefined) {
    return undefined;
  }
  const item: { oldText: string; newText: string; replaceAll?: boolean } = {
    oldText: oldString,
    newText: newString,
  };
  if (record.replace_all === true) {
    item.replaceAll = true;
  }
  record.edits = [item];
  delete record.old_string;
  delete record.new_string;
  delete record.replace_all;
  return 'old_string';
}

export function normalizeToolCallArguments(
  liveName: string,
  raw: unknown,
): NormalizedToolArguments {
  if (!isPlainObject(raw)) {
    return { args: (raw ?? {}) as Record<string, unknown> };
  }
  const args = { ...raw };
  let fieldAlias: string | undefined;

  if (
    liveName === 'read'
    || liveName === 'ls'
    || liveName === 'write'
    || liveName === 'edit'
    || liveName === 'mkdir'
    || liveName === 'move'
    || liveName === 'delete'
  ) {
    fieldAlias ??= applyPathAliases(args);
  }

  if (liveName === 'read') {
    const pagingAlias = normalizeReadPaging(args);
    fieldAlias ??= pagingAlias;
  }
  if (liveName === 'search') {
    const queryAlias = normalizeSearchQuery(args);
    fieldAlias ??= queryAlias;
  }
  if (liveName === 'bash') {
    const commandAlias = normalizeBashCommand(args);
    fieldAlias ??= commandAlias;
  }
  if (liveName === 'edit') {
    const editsAlias = normalizeEdits(args);
    fieldAlias ??= editsAlias;
  }
  if (liveName === 'write' && (args.mode === undefined || args.mode === null || args.mode === '')) {
    args.mode = 'overwrite';
  }

  return { args, fieldAlias };
}

export function buildAliasReminder(toolName: string, rawArguments: unknown): string | undefined {
  const liveName = resolveLiveToolName(toolName);
  if (isSilentToolNameAlias(toolName)) {
    return `Use the live tool name \`${liveName}\` next time.`;
  }
  const normalized = normalizeToolCallArguments(liveName, rawArguments);
  if (!normalized.fieldAlias) {
    return undefined;
  }
  switch (normalized.fieldAlias) {
    case 'file_path':
    case 'target_file':
      return 'Use the canonical field `path` next time.';
    case 'startLine':
    case 'endLine':
      return 'Use 1-indexed `offset` and `limit` next time.';
    case 'pattern':
      return 'Use the canonical field `query` next time.';
    case 'cmd':
      return 'Use the canonical field `command` next time.';
    case 'old_string':
      return 'Use `edits: [{ oldText, newText }]` next time.';
    default:
      return `Use the canonical field \`${normalized.fieldAlias}\` next time.`;
  }
}

export function canonicalizeToolCallName<T extends { name: string }>(toolCall: T): T {
  const live = resolveLiveToolName(toolCall.name);
  if (live !== toolCall.name) {
    toolCall.name = live;
  }
  return toolCall;
}

export function appendToolResultReminder(result: unknown, reminder: string): unknown {
  if (!isPlainObject(result)) {
    return result;
  }
  const rawContent = result.content;
  if (!Array.isArray(rawContent) || rawContent.length === 0) {
    return {
      ...result,
      content: [{ type: 'text', text: reminder }],
    };
  }
  const content: unknown[] = rawContent;
  const first = content[0];
  if (isPlainObject(first) && first.type === 'text' && typeof first.text === 'string') {
    return {
      ...result,
      content: [{ type: 'text', text: `${first.text}\n\n${reminder}` }, ...content.slice(1)],
    };
  }
  return {
    ...result,
    content: [...content, { type: 'text', text: reminder }],
  };
}

export function assertUniqueLiveToolNames(names: readonly string[]): void {
  const seen = new Set<string>();
  for (const name of names) {
    if (seen.has(name)) {
      throw new Error(`Duplicate live tool name: ${name}`);
    }
    seen.add(name);
  }
}

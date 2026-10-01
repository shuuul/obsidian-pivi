/** Editor selection toolbar settings: shortcut shapes, the editor-command catalog, and persisted-value normalization. */

export type EditorToolbarPiviActionId = 'inline-edit' | 'add-to-chat';
export type EditorToolbarExecutionTarget = 'inline-edit' | 'sidebar';

interface EditorToolbarItemBase {
  id: string;
  enabled: boolean;
}

export interface EditorToolbarPiviAction extends EditorToolbarItemBase {
  kind: 'pivi-action';
  actionId: EditorToolbarPiviActionId;
}

export interface EditorToolbarEditorCommand extends EditorToolbarItemBase {
  kind: 'editor-command';
  commandId: EditorCommandId;
}

/** Compatibility record retained for commands outside Pivi's curated editor catalog. */
export interface EditorToolbarLegacyCommand extends EditorToolbarItemBase {
  kind: 'obsidian-command';
  label: string;
  commandId: string;
  icon?: string;
}

export interface EditorToolbarPiviCommand extends EditorToolbarItemBase {
  kind: 'pivi-command';
  label: string;
  piviCommandKey: string;
  executionTarget: EditorToolbarExecutionTarget;
  icon?: string;
}

export type EditorToolbarShortcut =
  | EditorToolbarPiviAction
  | EditorToolbarEditorCommand
  | EditorToolbarLegacyCommand
  | EditorToolbarPiviCommand;

export interface EditorSelectionToolbarSettings {
  /**
   * Whether Pivi's selected-text toolbar owns the editor UI. When false, Pivi
   * stays out of the editor selection surface (e.g., disabled by the user or
   * yielding to Note Toolbar via runtime detection).
   */
  enabled: boolean;
  shortcuts: EditorToolbarShortcut[];
}

export const EDITOR_COMMAND_CATALOG = [
  ['editor:clear-formatting', 'eraser', 'formatting'], ['editor:toggle-blockquote', 'text-quote', 'formatting'], ['editor:toggle-bold', 'bold', 'formatting'], ['editor:toggle-code', 'code', 'formatting'], ['editor:toggle-comments', 'percent', 'formatting'], ['editor:toggle-highlight', 'highlighter', 'formatting'], ['editor:toggle-inline-math', 'sigma', 'formatting'], ['editor:toggle-italics', 'italic', 'formatting'], ['editor:toggle-strikethrough', 'strikethrough', 'formatting'],
  ['editor:set-heading', 'heading', 'headings'], ['editor:set-heading-0', 'heading', 'headings'], ['editor:set-heading-1', 'heading-1', 'headings'], ['editor:set-heading-2', 'heading-2', 'headings'], ['editor:set-heading-3', 'heading-3', 'headings'], ['editor:set-heading-4', 'heading-4', 'headings'], ['editor:set-heading-5', 'heading-5', 'headings'], ['editor:set-heading-6', 'heading-6', 'headings'],
  ['editor:cycle-list-checklist', 'check-square', 'lists'], ['editor:indent-list', 'indent-increase', 'lists'], ['editor:toggle-bullet-list', 'list', 'lists'], ['editor:toggle-checklist-status', 'list-checks', 'lists'], ['editor:toggle-numbered-list', 'list-ordered', 'lists'], ['editor:unindent-list', 'indent-decrease', 'lists'],
  ['editor:attach-file', 'paperclip', 'insert'], ['editor:insert-callout', 'quote', 'insert'], ['editor:insert-codeblock', 'code-square', 'insert'], ['editor:insert-footnote', 'file-signature', 'insert'], ['editor:insert-embed', 'sticky-note', 'insert'], ['editor:insert-horizontal-rule', 'line-horizontal', 'insert'], ['editor:insert-link', 'link', 'insert'], ['editor:insert-mathblock', 'sigma-square', 'insert'], ['editor:insert-table', 'table', 'insert'], ['editor:insert-tag', 'tag', 'insert'], ['editor:insert-wikilink', 'brackets', 'insert'],
  ['editor:add-cursor-above', 'mouse-pointer-click', 'lines'], ['editor:add-cursor-below', 'mouse-pointer-click', 'lines'], ['editor:delete-paragraph', 'pilcrow', 'lines'], ['editor:move-caret-up', 'chevron-up', 'lines'], ['editor:move-caret-down', 'chevron-down', 'lines'], ['editor:move-caret-left', 'chevron-left', 'lines'], ['editor:move-caret-right', 'chevron-right', 'lines'], ['editor:swap-line-down', 'corner-right-down', 'lines'], ['editor:swap-line-up', 'corner-right-up', 'lines'],
  ['editor:toggle-fold', 'fold-vertical', 'folding'], ['editor:fold-all', 'chevrons-up', 'folding'], ['editor:fold-less', 'minus', 'folding'], ['editor:fold-more', 'plus', 'folding'], ['editor:unfold-all', 'chevrons-down', 'folding'],
  ['editor:open-search-replace', 'file-search', 'controls'], ['editor:toggle-source', 'code-2', 'controls'], ['editor:toggle-keyboard', 'keyboard-toggle', 'controls'],
] as const;

export type EditorCommandId = (typeof EDITOR_COMMAND_CATALOG)[number][0];
export type EditorCommandCatalogEntry = {
  id: EditorCommandId;
  icon: string;
  category: (typeof EDITOR_COMMAND_CATALOG)[number][2];
};
export const EDITOR_COMMANDS: readonly EditorCommandCatalogEntry[] = EDITOR_COMMAND_CATALOG.map(
  ([id, icon, category]) => ({ id, icon, category }),
);
const EDITOR_COMMAND_IDS = new Set<string>(EDITOR_COMMANDS.map(command => command.id));
const REQUIRED_PIVI_ACTIONS: readonly EditorToolbarPiviActionId[] = ['inline-edit', 'add-to-chat'];

/**
 * Resolve the `enabled` flag from a raw settings value. Accepts the new
 * `enabled: boolean` field directly, and falls back to the legacy
 * `provider` field for backward compatibility:
 *   - 'pivi' / 'note-toolbar' → enabled true (runtime detection yields to Note Toolbar)
 *   - 'off' → enabled false
 *   - missing/invalid → default true
 */
function resolveToolbarEnabled(value: unknown): boolean {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'string') {
    if (value === 'off') {
      return false;
    }
    if (value === 'pivi' || value === 'note-toolbar') {
      return true;
    }
  }
  return true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

interface ToolbarShortcutNormalization {
  readonly seenIds: Set<string>;
  readonly seenActions: Set<EditorToolbarPiviActionId>;
  readonly seenEditorCommands: Set<string>;
  readonly shortcuts: EditorToolbarShortcut[];
}

const RESERVED_TOOLBAR_SHORTCUT_IDS = new Set<string>([...REQUIRED_PIVI_ACTIONS, ...EDITOR_COMMAND_IDS]);

function uniqueLegacyToolbarShortcutId(
  seenIds: ReadonlySet<string>,
  persistedId: string,
  kind: 'obsidian-command' | 'pivi-command',
): string {
  if (!RESERVED_TOOLBAR_SHORTCUT_IDS.has(persistedId) && !seenIds.has(persistedId)) return persistedId;
  const base = `legacy:${kind}:${persistedId}`;
  let candidate = base;
  let suffix = 2;
  while (RESERVED_TOOLBAR_SHORTCUT_IDS.has(candidate) || seenIds.has(candidate)) candidate = `${base}:${suffix++}`;
  return candidate;
}

function trimmedStringField(item: Record<string, unknown>, key: string): string {
  const value = item[key];
  return typeof value === 'string' ? value.trim() : '';
}

function normalizePiviActionShortcut(
  state: ToolbarShortcutNormalization,
  item: Record<string, unknown>,
  enabled: boolean,
): void {
  const actionId = item.actionId;
  if ((actionId !== 'inline-edit' && actionId !== 'add-to-chat') || state.seenActions.has(actionId)) return;
  state.seenIds.add(actionId);
  state.seenActions.add(actionId);
  state.shortcuts.push({ id: actionId, kind: 'pivi-action', actionId, enabled });
}

function normalizeCommandShortcut(
  state: ToolbarShortcutNormalization,
  item: Record<string, unknown>,
  kind: 'editor-command' | 'obsidian-command',
  id: string,
  enabled: boolean,
): void {
  const commandId = trimmedStringField(item, 'commandId');
  if (!commandId) {
    return;
  }
  if (EDITOR_COMMAND_IDS.has(commandId)) {
    if (state.seenEditorCommands.has(commandId)) return;
    state.seenIds.add(commandId);
    state.seenEditorCommands.add(commandId);
    state.shortcuts.push({ id: commandId, kind: 'editor-command', enabled, commandId: commandId as EditorCommandId });
    return;
  }
  if (kind === 'editor-command') return;
  const label = trimmedStringField(item, 'label');
  if (!label) return;
  const emittedId = uniqueLegacyToolbarShortcutId(state.seenIds, id, 'obsidian-command');
  state.seenIds.add(emittedId);
  const icon = trimmedStringField(item, 'icon') || undefined;
  state.shortcuts.push(icon ? { id: emittedId, kind, label, enabled, commandId, icon } : { id: emittedId, kind, label, enabled, commandId });
}

function normalizePiviCommandShortcut(
  state: ToolbarShortcutNormalization,
  item: Record<string, unknown>,
  id: string,
  enabled: boolean,
): void {
  const kind = 'pivi-command' as const;
  const label = trimmedStringField(item, 'label');
  const piviCommandKey = trimmedStringField(item, 'piviCommandKey');
  if (!label || !piviCommandKey) {
    return;
  }
  const emittedId = uniqueLegacyToolbarShortcutId(state.seenIds, id, kind);
  state.seenIds.add(emittedId);
  const piviIcon = trimmedStringField(item, 'icon') || undefined;
  const executionTarget: EditorToolbarExecutionTarget = item.executionTarget === 'inline-edit'
    ? 'inline-edit'
    : 'sidebar';
  state.shortcuts.push(piviIcon
    ? { id: emittedId, kind, label, enabled, piviCommandKey, executionTarget, icon: piviIcon }
    : { id: emittedId, kind, label, enabled, piviCommandKey, executionTarget });
}

export function normalizeEditorSelectionToolbarSettings(
  value: unknown,
): EditorSelectionToolbarSettings {
  const defaults = (): EditorToolbarShortcut[] => REQUIRED_PIVI_ACTIONS.map(actionId => ({
    id: actionId,
    kind: 'pivi-action',
    actionId,
    enabled: true,
  }));
  const empty: EditorSelectionToolbarSettings = { enabled: true, shortcuts: defaults() };
  if (!isRecord(value)) {
    return empty;
  }

  // Prefer the new `enabled` boolean; fall back to the legacy `provider` string
  // so existing persisted settings migrate cleanly.
  const toolbarEnabled = Object.hasOwn(value, 'enabled')
    ? resolveToolbarEnabled(value.enabled)
    : resolveToolbarEnabled(value.provider);
  if (!Array.isArray(value.shortcuts)) {
    return { enabled: toolbarEnabled, shortcuts: defaults() };
  }

  const state: ToolbarShortcutNormalization = {
    seenIds: new Set(),
    seenActions: new Set(),
    seenEditorCommands: new Set(),
    shortcuts: [],
  };
  for (const item of value.shortcuts) {
    if (!isRecord(item)) {
      continue;
    }
    const id = typeof item.id === 'string' ? item.id.trim() : '';
    if (!id) {
      continue;
    }
    const enabled = item.enabled !== false;
    if (item.kind === 'pivi-action') {
      normalizePiviActionShortcut(state, item, enabled);
    } else if (item.kind === 'editor-command' || item.kind === 'obsidian-command') {
      normalizeCommandShortcut(state, item, item.kind, id, enabled);
    } else if (item.kind === 'pivi-command') {
      normalizePiviCommandShortcut(state, item, id, enabled);
    }
  }
  const { seenActions, shortcuts } = state;

  const missingActions = REQUIRED_PIVI_ACTIONS
    .filter(actionId => !seenActions.has(actionId))
    .map(actionId => ({ id: actionId, kind: 'pivi-action' as const, actionId, enabled: true }));

  return { enabled: toolbarEnabled, shortcuts: [...missingActions, ...shortcuts] };
}

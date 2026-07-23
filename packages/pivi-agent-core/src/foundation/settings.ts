
import type { CustomProviderConfig } from "./customProviders";

/** Source of a slash command. */
export type SlashCommandSource = "builtin" | "user" | "plugin" | "sdk";

/** Slash command configuration shared by the UI, storage, and runtime boundary. */
export interface SlashCommand {
  id: string;
  name: string; // Command name used after / (e.g., "review-code")
  description?: string; // Optional description shown in dropdown
  argumentHint?: string; // Placeholder text for arguments (e.g., "[file] [focus]")
  icon?: string; // Host-neutral icon identifier used by presentation integrations
  integrationKey?: string; // Stable opaque identity for host command integrations
  allowedTools?: string[]; // Restrict tools when command is used
  model?: string; // Optional provider-specific model override
  content: string; // Prompt template with placeholders
  source?: SlashCommandSource; // Origin of the command (builtin, user, plugin, sdk)
  kind?: "command" | "skill"; // Explicit type — replaces id-prefix heuristic
  // Provider-owned command metadata that the UI preserves and round-trips.
  disableModelInvocation?: boolean; // Disable model invocation for this skill
  userInvocable?: boolean; // Whether user can invoke this skill directly
  context?: "fork"; // Subagent execution mode
  agent?: string; // Subagent type when context='fork'
  hooks?: Record<string, unknown>; // Pass-through to SDK
}

/** Keyboard navigation settings for vim-style scrolling. */
export interface KeyboardNavigationSettings {
  scrollUpKey: string; // Key to scroll up when focused on messages (default: 'w')
  scrollDownKey: string; // Key to scroll down when focused on messages (default: 's')
  focusInputKey: string; // Key to focus input (default: 'i', like vim insert mode)
}

/** Tab bar position setting. */
export type TabBarPosition = "input" | "header";

export const CHAT_VIEW_PLACEMENTS = [
  "right-sidebar",
  "left-sidebar",
  "main-tab",
] as const;

/** Workspace location used when opening the Pivi chat view. */
export type ChatViewPlacement = (typeof CHAT_VIEW_PLACEMENTS)[number];

/** Scope for environment variable storage and snippets. */
export type EnvironmentScope = "shared" | "agent";

/** Obsidian-native agent tool toggles (ADR-0009). */
export interface ObsidianToolsSettings {
  cliEnabled: boolean;
  /** Absolute path to obsidian CLI binary; auto-detected when omitted. */
  cliPath?: string | null;
  cliTimeoutMs: number;
  /** Tool names the user has explicitly disabled in settings. */
  disabledTools?: string[];
  allowCommand: boolean;
  commandAllowlist: string[];
  allowBash: boolean;
  bashAllowlist: string[];
  allowEval: boolean;
  /** Allow reading external files and folders under explicitly allowed directories. */
  allowExternalRead: boolean;
  /** Absolute directory roots that external read/list tools may access. */
  externalReadDirectories: string[];
}

const TOOL_OBSIDIAN_BASH_NAME = "obsidian_bash";

export const DEFAULT_OBSIDIAN_TOOLS_SETTINGS: Readonly<ObsidianToolsSettings> = Object.freeze({
  cliEnabled: false,
  cliPath: null,
  cliTimeoutMs: 30_000,
  disabledTools: [],
  allowCommand: false,
  commandAllowlist: [],
  allowBash: false,
  bashAllowlist: [],
  allowEval: false,
  allowExternalRead: false,
  externalReadDirectories: [],
});

function normalizeDisabledObsidianTools(value: readonly unknown[] | undefined): string[] {
  if (!Array.isArray(value)) {
    return [...(DEFAULT_OBSIDIAN_TOOLS_SETTINGS.disabledTools ?? [])];
  }
  return value.filter((tool): tool is string => (
    typeof tool === "string" &&
    tool !== TOOL_OBSIDIAN_BASH_NAME
  ));
}

export function resolveObsidianToolsSettings(
  raw: ObsidianToolsSettings | undefined,
): ObsidianToolsSettings {
  if (!raw) {
    return { ...DEFAULT_OBSIDIAN_TOOLS_SETTINGS, disabledTools: [] };
  }
  return {
    cliEnabled: raw.cliEnabled ?? DEFAULT_OBSIDIAN_TOOLS_SETTINGS.cliEnabled,
    cliPath: raw.cliPath ?? DEFAULT_OBSIDIAN_TOOLS_SETTINGS.cliPath,
    cliTimeoutMs: raw.cliTimeoutMs ?? DEFAULT_OBSIDIAN_TOOLS_SETTINGS.cliTimeoutMs,
    disabledTools: normalizeDisabledObsidianTools(raw.disabledTools),
    allowCommand: raw.allowCommand ?? DEFAULT_OBSIDIAN_TOOLS_SETTINGS.allowCommand,
    commandAllowlist: Array.isArray(raw.commandAllowlist)
      ? [...raw.commandAllowlist]
      : [...DEFAULT_OBSIDIAN_TOOLS_SETTINGS.commandAllowlist],
    allowBash: raw.allowBash ?? DEFAULT_OBSIDIAN_TOOLS_SETTINGS.allowBash,
    bashAllowlist: Array.isArray(raw.bashAllowlist)
      ? [...raw.bashAllowlist]
      : [...DEFAULT_OBSIDIAN_TOOLS_SETTINGS.bashAllowlist],
    allowEval: raw.allowEval ?? DEFAULT_OBSIDIAN_TOOLS_SETTINGS.allowEval,
    allowExternalRead: raw.allowExternalRead ?? DEFAULT_OBSIDIAN_TOOLS_SETTINGS.allowExternalRead,
    externalReadDirectories: Array.isArray(raw.externalReadDirectories)
      ? raw.externalReadDirectories.filter((directory): directory is string => typeof directory === "string")
      : [...DEFAULT_OBSIDIAN_TOOLS_SETTINGS.externalReadDirectories],
  };
}

export function getObsidianToolsSettingsFromBag(
  settings: Record<string, unknown>,
): ObsidianToolsSettings {
  const agentSettings = settings.agentSettings;
  if (!agentSettings || typeof agentSettings !== "object" || Array.isArray(agentSettings)) {
    return { ...DEFAULT_OBSIDIAN_TOOLS_SETTINGS, disabledTools: [] };
  }
  const obsidianTools = (agentSettings as { obsidianTools?: ObsidianToolsSettings }).obsidianTools;
  return resolveObsidianToolsSettings(obsidianTools);
}

/** Active agent runtime settings persisted on the top-level settings bag. */
export interface AgentRuntimeSettings {
  addedProviders?: string[];
  /** Providers kept in settings but excluded from model picker and API resolution. */
  disabledProviders?: string[];
  environmentVariables: string;
  selectedMode: string;
  visibleModels: string[];
  lastModel?: string;
  environmentHash?: string;
  /** User-defined local / OpenAI-compatible / Anthropic-compatible providers. */
  customProviders?: CustomProviderConfig[];
  obsidianTools?: ObsidianToolsSettings;
  /** Web search agent tool settings (provider chain + toggle). */
  webSearchTools?: WebSearchToolsSettings;
  /** Subagent runtime limits and feature toggles. */
  subagents?: SubagentRuntimeSettings;
}

export interface SubagentRuntimeSettings {
  enabled: boolean;
  maxConcurrentSubagents: number;
  allowBackground: boolean;
}

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

function normalizeHiddenCommandName(value: string): string {
  return value.trim().replace(/^[/$]+/, "");
}

export function normalizeHiddenCommandList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const item of value) {
    if (typeof item !== "string") {
      continue;
    }

    const commandName = normalizeHiddenCommandName(item);
    if (!commandName) {
      continue;
    }

    const key = commandName.toLowerCase();
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    normalized.push(commandName);
  }

  return normalized;
}

export function getHiddenSlashCommands(
  settings: Pick<PiviSettings, "hiddenSlashCommands">,
): string[] {
  return settings.hiddenSlashCommands ?? [];
}

export function getHiddenSlashCommandSet(
  settings: Pick<PiviSettings, "hiddenSlashCommands">,
): Set<string> {
  return new Set(
    getHiddenSlashCommands(settings).map((command) => command.toLowerCase()),
  );
}

/** Normalized ordered workspace-command ids used to sort `.pivi/commands/` entries. */
export function normalizeWorkspaceCommandOrder(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const item of value) {
    if (typeof item !== "string") {
      continue;
    }
    const id = item.trim();
    if (!id) {
      continue;
    }
    const key = id.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    normalized.push(id);
  }

  return normalized;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
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

  const seenIds = new Set<string>();
  const seenActions = new Set<EditorToolbarPiviActionId>();
  const seenEditorCommands = new Set<string>();
  const shortcuts: EditorToolbarShortcut[] = [];
  const reservedIds = new Set<string>([...REQUIRED_PIVI_ACTIONS, ...EDITOR_COMMAND_IDS]);
  const uniqueLegacyId = (persistedId: string, kind: 'obsidian-command' | 'pivi-command'): string => {
    if (!reservedIds.has(persistedId) && !seenIds.has(persistedId)) return persistedId;
    const base = `legacy:${kind}:${persistedId}`;
    let candidate = base;
    let suffix = 2;
    while (reservedIds.has(candidate) || seenIds.has(candidate)) candidate = `${base}:${suffix++}`;
    return candidate;
  };

  for (const item of value.shortcuts) {
    if (!isRecord(item)) {
      continue;
    }

    const id = typeof item.id === 'string' ? item.id.trim() : '';
    const kind = typeof item.kind === 'string' ? item.kind : '';
    if (!id) {
      continue;
    }
    const enabled = item.enabled !== false;

    if (kind === 'pivi-action') {
      const actionId = item.actionId;
      if ((actionId !== 'inline-edit' && actionId !== 'add-to-chat') || seenActions.has(actionId)) continue;
      seenIds.add(actionId);
      seenActions.add(actionId);
      shortcuts.push({ id: actionId, kind, actionId, enabled });
      continue;
    }

    if (kind === 'editor-command' || kind === 'obsidian-command') {
      const commandId = typeof item.commandId === 'string' ? item.commandId.trim() : '';
      if (!commandId) {
        continue;
      }
      if (EDITOR_COMMAND_IDS.has(commandId)) {
        if (seenEditorCommands.has(commandId)) continue;
        seenIds.add(commandId);
        seenEditorCommands.add(commandId);
        shortcuts.push({ id: commandId, kind: 'editor-command', enabled, commandId: commandId as EditorCommandId });
        continue;
      }
      if (kind === 'editor-command') continue;
      const label = typeof item.label === 'string' ? item.label.trim() : '';
      if (!label) continue;
      const emittedId = uniqueLegacyId(id, 'obsidian-command');
      seenIds.add(emittedId);
      const icon = typeof item.icon === 'string' && item.icon.trim() ? item.icon.trim() : undefined;
      shortcuts.push(icon ? { id: emittedId, kind, label, enabled, commandId, icon } : { id: emittedId, kind, label, enabled, commandId });
      continue;
    }

    if (kind !== 'pivi-command') continue;
    const label = typeof item.label === 'string' ? item.label.trim() : '';
    const piviCommandKey = typeof item.piviCommandKey === 'string'
      ? item.piviCommandKey.trim()
      : '';
    if (!label || !piviCommandKey) {
      continue;
    }
    const emittedId = uniqueLegacyId(id, 'pivi-command');
    seenIds.add(emittedId);
    const piviIcon = typeof item.icon === 'string' && item.icon.trim() ? item.icon.trim() : undefined;
    const executionTarget: EditorToolbarExecutionTarget = item.executionTarget === 'inline-edit'
      ? 'inline-edit'
      : 'sidebar';
    shortcuts.push(piviIcon
      ? { id: emittedId, kind, label, enabled, piviCommandKey, executionTarget, icon: piviIcon }
      : { id: emittedId, kind, label, enabled, piviCommandKey, executionTarget });
  }

  const missingActions = REQUIRED_PIVI_ACTIONS
    .filter(actionId => !seenActions.has(actionId))
    .map(actionId => ({ id: actionId, kind: 'pivi-action' as const, actionId, enabled: true }));

  return { enabled: toolbarEnabled, shortcuts: [...missingActions, ...shortcuts] };
}

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === "string")
  );
}

function isOptionalStringArray(value: unknown): value is string[] | undefined {
  return value === undefined || isStringArray(value);
}

function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === "string";
}

function isOptionalObsidianToolsSettings(
  value: unknown,
): value is ObsidianToolsSettings | undefined {
  if (value === undefined) {
    return true;
  }

  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.cliEnabled === "boolean" &&
    (typeof value.cliPath === "string" ||
      value.cliPath === null ||
      value.cliPath === undefined) &&
    typeof value.cliTimeoutMs === "number" &&
    isOptionalStringArray(value.disabledTools) &&
    typeof value.allowCommand === "boolean" &&
    isStringArray(value.commandAllowlist) &&
    (value.allowBash === undefined || typeof value.allowBash === "boolean") &&
    isOptionalStringArray(value.bashAllowlist) &&
    typeof value.allowEval === "boolean" &&
    typeof value.allowExternalRead === "boolean" &&
    isOptionalStringArray(value.externalReadDirectories)
  );
}

/** Configurable providers shared by the WebSearch and WebFetch fallback queues. */
export type WebProviderId = 'brave' | 'tavily' | 'exa' | 'anysearch';

export interface WebProviderCapabilities {
  search: boolean;
  fetch: boolean;
  apiKeyRequired: boolean;
}

/** Canonical default priority. Fixed Exa MCP/direct HTTP fallbacks are not configurable providers. */
export const WEB_PROVIDER_IDS: readonly WebProviderId[] = ['brave', 'tavily', 'exa', 'anysearch'];

export const WEB_PROVIDER_CAPABILITIES: Readonly<Record<WebProviderId, WebProviderCapabilities>> = Object.freeze({
  brave: Object.freeze({ search: true, fetch: false, apiKeyRequired: true }),
  tavily: Object.freeze({ search: true, fetch: true, apiKeyRequired: true }),
  exa: Object.freeze({ search: true, fetch: true, apiKeyRequired: true }),
  anysearch: Object.freeze({ search: true, fetch: true, apiKeyRequired: false }),
});

/** How WebFetch may disclose the user target URL to third-party extractors. */
export type WebFetchMode = 'direct-only' | 'allow-extractors';

export const WEB_FETCH_MODES: readonly WebFetchMode[] = ['direct-only', 'allow-extractors'];

export function isWebFetchMode(value: unknown): value is WebFetchMode {
  return typeof value === 'string' && (WEB_FETCH_MODES as readonly string[]).includes(value);
}

/** Ordered, shared WebSearch/WebFetch provider configuration. */
export interface WebSearchToolsSettings {
  providerOrder: WebProviderId[];
  disabledProviders: WebProviderId[];
  /**
   * `direct-only` (default) never sends the target URL to Tavily/Exa/AnySearch.
   * `allow-extractors` permits the ordered provider chain before direct HTTP.
   */
  fetchMode: WebFetchMode;
}

interface LegacyWebSearchToolsSettings {
  provider?: unknown;
  searchProvider?: unknown;
  fetchProvider?: unknown;
}

export const DEFAULT_WEB_SEARCH_TOOLS_SETTINGS: Readonly<WebSearchToolsSettings> = Object.freeze({
  providerOrder: [...WEB_PROVIDER_IDS],
  disabledProviders: [],
  fetchMode: 'direct-only',
});

export const DEFAULT_SUBAGENT_RUNTIME_SETTINGS: Readonly<SubagentRuntimeSettings> = Object.freeze({
  enabled: true,
  maxConcurrentSubagents: 3,
  allowBackground: true,
});

export function isWebProviderId(value: unknown): value is WebProviderId {
  return typeof value === 'string' && (WEB_PROVIDER_IDS as readonly string[]).includes(value);
}

export function resolveWebSearchToolsSettings(
  raw: WebSearchToolsSettings | LegacyWebSearchToolsSettings | undefined,
): WebSearchToolsSettings {
  if (!raw) {
    return {
      providerOrder: [...DEFAULT_WEB_SEARCH_TOOLS_SETTINGS.providerOrder],
      disabledProviders: [],
      fetchMode: DEFAULT_WEB_SEARCH_TOOLS_SETTINGS.fetchMode,
    };
  }
  const providerOrder: WebProviderId[] = [];
  const addProvider = (value: unknown): void => {
    if (isWebProviderId(value) && !providerOrder.includes(value)) {
      providerOrder.push(value);
    }
  };
  if ('providerOrder' in raw && Array.isArray(raw.providerOrder)) {
    raw.providerOrder.forEach(addProvider);
  } else {
    const legacyProvider = 'provider' in raw ? raw.provider : undefined;
    addProvider('searchProvider' in raw ? raw.searchProvider : legacyProvider);
    addProvider('fetchProvider' in raw ? raw.fetchProvider : undefined);
  }
  WEB_PROVIDER_IDS.forEach(addProvider);
  const disabledProviders = 'disabledProviders' in raw && Array.isArray(raw.disabledProviders)
    ? raw.disabledProviders.filter(isWebProviderId).filter((id, index, ids) => ids.indexOf(id) === index)
    : [];
  const fetchMode = 'fetchMode' in raw && isWebFetchMode(raw.fetchMode)
    ? raw.fetchMode
    : DEFAULT_WEB_SEARCH_TOOLS_SETTINGS.fetchMode;
  return {
    providerOrder,
    disabledProviders,
    fetchMode,
  };
}

export function getWebSearchToolsSettingsFromBag(
  settings: Record<string, unknown>,
): WebSearchToolsSettings {
  const agentSettings = settings.agentSettings;
  if (!agentSettings || typeof agentSettings !== 'object' || Array.isArray(agentSettings)) {
    return resolveWebSearchToolsSettings(undefined);
  }
  if (!('webSearchTools' in agentSettings)) {
    return resolveWebSearchToolsSettings(undefined);
  }
  return resolveWebSearchToolsSettings(agentSettings.webSearchTools as WebSearchToolsSettings | LegacyWebSearchToolsSettings | undefined);
}

function isOptionalWebSearchToolsSettings(
  value: unknown,
): value is WebSearchToolsSettings | LegacyWebSearchToolsSettings | undefined {
  if (value === undefined) {
    return true;
  }
  if (!isRecord(value)) {
    return false;
  }
  return (
    (value.providerOrder === undefined || Array.isArray(value.providerOrder)) &&
    (value.disabledProviders === undefined || Array.isArray(value.disabledProviders)) &&
    (value.fetchMode === undefined || isWebFetchMode(value.fetchMode)) &&
    (value.searchProvider === undefined || typeof value.searchProvider === 'string') &&
    (value.fetchProvider === undefined || typeof value.fetchProvider === 'string') &&
    (value.provider === undefined || typeof value.provider === 'string')
  );
}

function isOptionalSubagentRuntimeSettings(
  value: unknown,
): value is SubagentRuntimeSettings | undefined {
  if (value === undefined) {
    return true;
  }
  if (!isRecord(value)) {
    return false;
  }
  return (
    typeof value.enabled === 'boolean' &&
    typeof value.maxConcurrentSubagents === 'number' &&
    typeof value.allowBackground === 'boolean'
  );
}

export function resolveSubagentRuntimeSettings(
  raw: Partial<SubagentRuntimeSettings> | undefined,
): SubagentRuntimeSettings {
  const defaults = DEFAULT_SUBAGENT_RUNTIME_SETTINGS;
  return {
    enabled: typeof raw?.enabled === 'boolean' ? raw.enabled : defaults.enabled,
    maxConcurrentSubagents: typeof raw?.maxConcurrentSubagents === 'number'
      ? Math.max(1, Math.floor(raw.maxConcurrentSubagents))
      : defaults.maxConcurrentSubagents,
    allowBackground: typeof raw?.allowBackground === 'boolean'
      ? raw.allowBackground
      : defaults.allowBackground,
  };
}

export function getSubagentRuntimeSettingsFromBag(
  settings: Record<string, unknown>,
): SubagentRuntimeSettings {
  const agentSettings = settings.agentSettings;
  if (!agentSettings || typeof agentSettings !== 'object' || Array.isArray(agentSettings)) {
    return { ...DEFAULT_SUBAGENT_RUNTIME_SETTINGS };
  }
  const subagents = (agentSettings as { subagents?: Partial<SubagentRuntimeSettings> }).subagents;
  return resolveSubagentRuntimeSettings(subagents);
}

export function isAgentRuntimeSettings(
  value: unknown,
): value is AgentRuntimeSettings {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.environmentVariables === 'string' &&
    typeof value.selectedMode === 'string' &&
    isStringArray(value.visibleModels) &&
    isOptionalStringArray(value.addedProviders) &&
    isOptionalStringArray(value.disabledProviders) &&
    isOptionalString(value.lastModel) &&
    isOptionalString(value.environmentHash) &&
    (value.customProviders === undefined || Array.isArray(value.customProviders)) &&
    isOptionalObsidianToolsSettings(value.obsidianTools) &&
    isOptionalWebSearchToolsSettings(value.webSearchTools) &&
    isOptionalSubagentRuntimeSettings(value.subagents)
  );
}

/**
 * Application settings stored in .pivi/settings.json.
 *
 * Pi-specific fields (model, thinkingBudget, thinkingLevel, etc.) use
 * `string` here.  The active provider casts internally when it needs
 * narrower types.
 */
export interface PiviSettings {
  // User preferences
  userName: string;

  // Model & thinking (provider interprets values)
  model: string;
  thinkingBudget: string;
  thinkingLevel: string;
  enableAutoTitleGeneration: boolean;
  titleGenerationModel: string;

  // Content settings
  excludedTags: string[];

  // Environment
  sharedEnvironmentVariables: string;
  customContextLimits: Record<string, number>;

  // UI settings
  keyboardNavigation: KeyboardNavigationSettings;
  requireCommandOrControlEnterToSend: boolean;

  // Internationalization
  locale: string;

  // Agent runtime settings (Pi providers, credentials, model pool)
  agentSettings: AgentRuntimeSettings;


  // UI preferences
  tabBarPosition: TabBarPosition;
  enableAutoScroll: boolean;
  deferMathRenderingDuringStreaming: boolean;
  chatViewPlacement: ChatViewPlacement;

  // Slash command visibility (names without leading /)
  hiddenSlashCommands: string[];

  /** Persisted display order of workspace slash command ids (file stems). */
  workspaceCommandOrder: string[];

  /** Editor selection toolbar shortcut buttons. */
  editorSelectionToolbar: EditorSelectionToolbarSettings;

  /** Set after first successful default skills bundle install for this vault. */
  defaultVaultSkillsSeeded?: boolean;
  /** User dismissed the startup prompt for the default skills bundle. */
  defaultVaultSkillsPromptDismissed?: boolean;
  /** Last applied kepano/obsidian-skills commit on main (GitHub API). */
  defaultVaultSkillsCommitSha?: string;
  /** Default-bundle folder names the user removed; not restored on upstream updates. */
  defaultVaultSkillsRemovedFolders?: string[];

  /** Set after the editable default workspace commands are seeded once. */
  defaultWorkspaceCommandsSeeded?: boolean;

  // Allow provider-specific extension fields
  [key: string]: unknown;
}


import type { PersistentBashPermission, PersistentExternalDirectoryPermission } from '../tools/capabilityPermissions';
import { migrateDisabledToolNames } from '../tools/toolAliases';
import type { CustomProviderConfig } from "./customProviders";
import type { EditorSelectionToolbarSettings } from './editorSelectionToolbarSettings';

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

/** Provider request deadlines in milliseconds. A value of 0 disables that deadline. */
export interface ProviderRequestDeadlines {
  totalMs: number;
  idleMs: number;
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
  /** Default character limit used when a read tool call omits maxChars. */
  defaultReadMaxChars: number;
  /** Tool names the user has explicitly disabled in settings. */
  disabledTools?: string[];
  allowCommand: boolean;
  commandAllowlist: string[];
  allowBash: boolean;
  /** Legacy encoded allowlist; empty after device-local permission migration. */
  bashAllowlist: string[];
  /** Structured persistent Bash grants overlaid from device-local storage. */
  bashPermissions: PersistentBashPermission[];
  /** Allow reading external files and folders under explicitly allowed directories. */
  allowExternalRead: boolean;
  /** Absolute directory roots that external read/list tools may access. */
  externalReadDirectories: string[];
  /** Full device-local external-directory grants, including disabled records. */
  externalDirectoryPermissions: PersistentExternalDirectoryPermission[];
}

export const DEFAULT_OBSIDIAN_TOOLS_SETTINGS: Readonly<ObsidianToolsSettings> = Object.freeze({
  cliEnabled: false,
  cliPath: null,
  cliTimeoutMs: 30_000,
  defaultReadMaxChars: 100_000,
  disabledTools: [],
  allowCommand: false,
  commandAllowlist: [],
  allowBash: false,
  bashAllowlist: [],
  bashPermissions: [],
  allowExternalRead: false,
  externalReadDirectories: [],
  externalDirectoryPermissions: [],
});

function normalizeDisabledObsidianTools(value: readonly unknown[] | undefined): string[] {
  if (!Array.isArray(value)) {
    return [...(DEFAULT_OBSIDIAN_TOOLS_SETTINGS.disabledTools ?? [])];
  }
  return migrateDisabledToolNames(value);
}

export function resolveObsidianToolsSettings(
  raw: ObsidianToolsSettings | undefined,
): ObsidianToolsSettings {
  if (!raw) {
    return { ...DEFAULT_OBSIDIAN_TOOLS_SETTINGS, disabledTools: [] };
  }
  return {
    cliEnabled: raw.cliEnabled ?? DEFAULT_OBSIDIAN_TOOLS_SETTINGS.cliEnabled,
    cliPath: typeof raw.cliPath === 'string' ? raw.cliPath.trim() || null : DEFAULT_OBSIDIAN_TOOLS_SETTINGS.cliPath,
    cliTimeoutMs: typeof raw.cliTimeoutMs === 'number' && Number.isFinite(raw.cliTimeoutMs)
      ? Math.max(1_000, Math.min(300_000, Math.floor(raw.cliTimeoutMs)))
      : DEFAULT_OBSIDIAN_TOOLS_SETTINGS.cliTimeoutMs,
    defaultReadMaxChars: typeof raw.defaultReadMaxChars === 'number'
      ? Math.max(1_000, Math.floor(raw.defaultReadMaxChars))
      : DEFAULT_OBSIDIAN_TOOLS_SETTINGS.defaultReadMaxChars,
    disabledTools: normalizeDisabledObsidianTools(raw.disabledTools),
    allowCommand: raw.allowCommand ?? DEFAULT_OBSIDIAN_TOOLS_SETTINGS.allowCommand,
    commandAllowlist: Array.isArray(raw.commandAllowlist)
      ? [...raw.commandAllowlist]
      : [...DEFAULT_OBSIDIAN_TOOLS_SETTINGS.commandAllowlist],
    allowBash: raw.allowBash ?? DEFAULT_OBSIDIAN_TOOLS_SETTINGS.allowBash,
    bashAllowlist: Array.isArray(raw.bashAllowlist)
      ? [...raw.bashAllowlist]
      : [...DEFAULT_OBSIDIAN_TOOLS_SETTINGS.bashAllowlist],
    bashPermissions: Array.isArray(raw.bashPermissions)
      ? [...raw.bashPermissions]
      : [...DEFAULT_OBSIDIAN_TOOLS_SETTINGS.bashPermissions],
    allowExternalRead: raw.allowExternalRead ?? DEFAULT_OBSIDIAN_TOOLS_SETTINGS.allowExternalRead,
    externalReadDirectories: Array.isArray(raw.externalReadDirectories)
      ? raw.externalReadDirectories.filter((directory): directory is string => typeof directory === "string")
      : [...DEFAULT_OBSIDIAN_TOOLS_SETTINGS.externalReadDirectories],
    externalDirectoryPermissions: Array.isArray(raw.externalDirectoryPermissions)
      ? [...raw.externalDirectoryPermissions]
      : [...DEFAULT_OBSIDIAN_TOOLS_SETTINGS.externalDirectoryPermissions],
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
  visibleModels: string[];
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

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === "string")
  );
}

function isOptionalStringArray(value: unknown): value is string[] | undefined {
  return value === undefined || isStringArray(value);
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
    typeof value.cliTimeoutMs === "number" && Number.isFinite(value.cliTimeoutMs) &&
    (value.defaultReadMaxChars === undefined || typeof value.defaultReadMaxChars === "number") &&
    isOptionalStringArray(value.disabledTools) &&
    typeof value.allowCommand === "boolean" &&
    isStringArray(value.commandAllowlist) &&
    (value.allowBash === undefined || typeof value.allowBash === "boolean") &&
    isOptionalStringArray(value.bashAllowlist) &&
    (value.bashPermissions === undefined || Array.isArray(value.bashPermissions)) &&
    typeof value.allowExternalRead === "boolean" &&
    isOptionalStringArray(value.externalReadDirectories) &&
    (value.externalDirectoryPermissions === undefined || Array.isArray(value.externalDirectoryPermissions))
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

/** Ordered, shared WebSearch/WebFetch provider configuration. */
export interface WebSearchToolsSettings {
  providerOrder: WebProviderId[];
  disabledProviders: WebProviderId[];
}

interface LegacyWebSearchToolsSettings {
  provider?: unknown;
  searchProvider?: unknown;
  fetchProvider?: unknown;
}

export const DEFAULT_WEB_SEARCH_TOOLS_SETTINGS: Readonly<WebSearchToolsSettings> = Object.freeze({
  providerOrder: [...WEB_PROVIDER_IDS],
  disabledProviders: [],
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
  return {
    providerOrder,
    disabledProviders,
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
    isStringArray(value.visibleModels) &&
    isOptionalStringArray(value.addedProviders) &&
    isOptionalStringArray(value.disabledProviders) &&
    (value.customProviders === undefined || Array.isArray(value.customProviders)) &&
    isOptionalObsidianToolsSettings(value.obsidianTools) &&
    isOptionalWebSearchToolsSettings(value.webSearchTools) &&
    isOptionalSubagentRuntimeSettings(value.subagents)
  );
}

/**
 * Application settings stored in .pivi/settings.json.
 *
 * Pi-specific fields (model, thinkingLevel, etc.) use
 * `string` here.  The active provider casts internally when it needs
 * narrower types.
 */
export interface PiviSettings {
  // User preferences
  userName: string;

  // Model & thinking (provider interprets values)
  model: string;
  thinkingLevel: string;
  enableAutoTitleGeneration: boolean;
  titleGenerationModel: string;

  // Content settings
  excludedTags: string[];
  deletedSessionRetentionDays: number;

  // Environment
  sharedEnvironmentVariables: string;
  customContextLimits: Record<string, number>;
  providerRequestDeadlines: ProviderRequestDeadlines;

  // UI settings
  requireCommandOrControlEnterToSend: boolean;

  // Internationalization
  locale: string;

  // Agent runtime settings (Pi providers, credentials, model pool)
  agentSettings: AgentRuntimeSettings;


  // UI preferences
  tabBarPosition: TabBarPosition;
  enableAutoScroll: boolean;
  deferMathRenderingDuringStreaming: boolean;
  showCacheHitRate: boolean;
  showTokensPerSecond: boolean;
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

  /** Shipped prompt-module enablement and body overrides. Absent keys use shipped defaults. */
  promptModules: Record<string, { enabled?: boolean; customBody?: string }>;
  /** User-created prompt modules appended after shipped workflow modules in this order. */
  customPromptModules: Array<{ id: string; title: string; body: string; enabled: boolean }>;

  // Allow provider-specific extension fields
  [key: string]: unknown;
}

export * from './editorSelectionToolbarSettings';


/** Source of a slash command. */
export type SlashCommandSource = "builtin" | "user" | "plugin" | "sdk";

/** Slash command configuration shared by the UI, storage, and runtime boundary. */
export interface SlashCommand {
  id: string;
  name: string; // Command name used after / (e.g., "review-code")
  description?: string; // Optional description shown in dropdown
  argumentHint?: string; // Placeholder text for arguments (e.g., "[file] [focus]")
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
  allowEval: boolean;
}

export const DEFAULT_OBSIDIAN_TOOLS_SETTINGS: Readonly<ObsidianToolsSettings> = Object.freeze({
  cliEnabled: true,
  cliPath: null,
  cliTimeoutMs: 30_000,
  disabledTools: [],
  allowCommand: false,
  commandAllowlist: [],
  allowEval: false,
});

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
    disabledTools: Array.isArray(raw.disabledTools)
      ? raw.disabledTools.filter((tool): tool is string => typeof tool === "string")
      : [...(DEFAULT_OBSIDIAN_TOOLS_SETTINGS.disabledTools ?? [])],
    allowCommand: raw.allowCommand ?? DEFAULT_OBSIDIAN_TOOLS_SETTINGS.allowCommand,
    commandAllowlist: Array.isArray(raw.commandAllowlist)
      ? [...raw.commandAllowlist]
      : [...DEFAULT_OBSIDIAN_TOOLS_SETTINGS.commandAllowlist],
    allowEval: raw.allowEval ?? DEFAULT_OBSIDIAN_TOOLS_SETTINGS.allowEval,
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
    typeof value.allowEval === "boolean"
  );
}

/** Concrete web search provider ids usable as preferred provider or chain member. */
export type WebSearchProviderId = 'brave' | 'tavily' | 'exa';

/** Preferred provider, or `auto` to use the credential-based chain. */
export type WebSearchProviderChoice = 'auto' | WebSearchProviderId;

/** All valid web search provider ids in canonical order. */
export const WEB_SEARCH_PROVIDER_IDS: readonly WebSearchProviderId[] = ['brave', 'tavily', 'exa'];

/** All valid web search provider choices (includes `auto`). */
export const WEB_SEARCH_PROVIDER_CHOICES: readonly WebSearchProviderChoice[] = ['auto', 'brave', 'tavily', 'exa'];

export type WebFetchProviderId = 'tavily' | 'exa';

export type WebFetchProviderChoice = 'auto' | WebFetchProviderId;

export const WEB_FETCH_PROVIDER_IDS: readonly WebFetchProviderId[] = ['tavily', 'exa'];

export const WEB_FETCH_PROVIDER_CHOICES: readonly WebFetchProviderChoice[] = ['auto', 'tavily', 'exa'];

/** Web agent tool settings (preferred providers + fallback chains). */
export interface WebSearchToolsSettings {
  /** Preferred provider for WebSearch; `auto` uses credential-based chain with Exa MCP fallback. */
  searchProvider: WebSearchProviderChoice;
  /** Preferred provider for WebFetch; `auto` tries fetch-capable credentialed providers. */
  fetchProvider: WebFetchProviderChoice;
}

interface LegacyWebSearchToolsSettings {
  provider?: unknown;
  searchProvider?: unknown;
  fetchProvider?: unknown;
}

export const DEFAULT_WEB_SEARCH_TOOLS_SETTINGS: Readonly<WebSearchToolsSettings> = Object.freeze({
  searchProvider: 'auto',
  fetchProvider: 'auto',
});

export const DEFAULT_SUBAGENT_RUNTIME_SETTINGS: Readonly<SubagentRuntimeSettings> = Object.freeze({
  enabled: true,
  maxConcurrentSubagents: 3,
  allowBackground: true,
});

function isWebSearchProviderChoice(value: unknown): value is WebSearchProviderChoice {
  return typeof value === 'string' && (WEB_SEARCH_PROVIDER_CHOICES as readonly string[]).includes(value);
}

function isWebFetchProviderChoice(value: unknown): value is WebFetchProviderChoice {
  return typeof value === 'string' && (WEB_FETCH_PROVIDER_CHOICES as readonly string[]).includes(value);
}

export function resolveWebSearchToolsSettings(
  raw: WebSearchToolsSettings | LegacyWebSearchToolsSettings | undefined,
): WebSearchToolsSettings {
  if (!raw) {
    return { ...DEFAULT_WEB_SEARCH_TOOLS_SETTINGS };
  }
  const legacyProvider = 'provider' in raw ? raw.provider : undefined;
  const rawSearchProvider = 'searchProvider' in raw ? raw.searchProvider : legacyProvider;
  const rawFetchProvider = 'fetchProvider' in raw ? raw.fetchProvider : undefined;
  return {
    searchProvider: isWebSearchProviderChoice(rawSearchProvider)
      ? rawSearchProvider
      : DEFAULT_WEB_SEARCH_TOOLS_SETTINGS.searchProvider,
    fetchProvider: isWebFetchProviderChoice(rawFetchProvider)
      ? rawFetchProvider
      : DEFAULT_WEB_SEARCH_TOOLS_SETTINGS.fetchProvider,
  };
}

export function getWebSearchToolsSettingsFromBag(
  settings: Record<string, unknown>,
): WebSearchToolsSettings {
  const agentSettings = settings.agentSettings;
  if (!agentSettings || typeof agentSettings !== 'object' || Array.isArray(agentSettings)) {
    return { ...DEFAULT_WEB_SEARCH_TOOLS_SETTINGS };
  }
  if (!('webSearchTools' in agentSettings)) {
    return { ...DEFAULT_WEB_SEARCH_TOOLS_SETTINGS };
  }
  const webSearchTools = agentSettings.webSearchTools;
  return resolveWebSearchToolsSettings(
    isOptionalWebSearchToolsSettings(webSearchTools) ? webSearchTools : undefined,
  );
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
    (value.searchProvider === undefined || isWebSearchProviderChoice(value.searchProvider)) &&
    (value.fetchProvider === undefined || isWebFetchProviderChoice(value.fetchProvider)) &&
    (value.provider === undefined || isWebSearchProviderChoice(value.provider))
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

  // Context compaction
  enableAutoCompact: boolean;
  autoCompactThresholdRatio: number;
  autoCompactKeepRecentTokens: number;

  // Content settings
  excludedTags: string[];
  persistentExternalContextPaths: string[];

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

  /** Set after first successful default skills bundle install for this vault. */
  defaultVaultSkillsSeeded?: boolean;
  /** User dismissed the startup prompt for the default skills bundle. */
  defaultVaultSkillsPromptDismissed?: boolean;
  /** Last applied kepano/obsidian-skills commit on main (GitHub API). */
  defaultVaultSkillsCommitSha?: string;
  /** Default-bundle folder names the user removed; not restored on upstream updates. */
  defaultVaultSkillsRemovedFolders?: string[];

  // Allow provider-specific extension fields
  [key: string]: unknown;
}

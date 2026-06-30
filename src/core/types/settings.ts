export interface ApprovalSelectionDecision {
  type: "select-option";
  value: string;
}

/** User decision from the approval modal. */
export type ApprovalDecision =
  | "allow"
  | "allow-always"
  | "deny"
  | "cancel"
  | ApprovalSelectionDecision;

/** Saved environment variable configuration. */
export interface EnvSnippet {
  id: string;
  name: string;
  description: string;
  envVars: string;
  scope?: EnvironmentScope;
  contextLimits?: Record<string, number>; // Optional: context limits for custom models
}

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

/** Permission mode for plan-mode UI (Pi has no Safe/YOLO sandbox). */
export type PermissionMode = "plan" | "normal";

/** Scope for environment variable storage and snippets. */
export type EnvironmentScope = "shared" | "pi";

/** Obsidian-native agent tool toggles (ADR-0009). */
export interface ObsidianToolsSettings {
  cliEnabled: boolean;
  /** Absolute path to obsidian CLI binary; auto-detected when omitted. */
  cliPath?: string | null;
  cliTimeoutMs: number;
  allowCommand: boolean;
  commandAllowlist: string[];
  allowEval: boolean;
}

/** Pi agent settings persisted on the top-level settings bag. */
export interface PiAgentSettings {
  addedProviders?: string[];
  /** Providers kept in settings but excluded from model picker and API resolution. */
  disabledProviders?: string[];
  environmentVariables: string;
  selectedMode: string;
  visibleModels: string[];
  lastModel?: string;
  environmentHash?: string;
  obsidianTools?: ObsidianToolsSettings;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isOptionalStringArray(value: unknown): value is string[] | undefined {
  return value === undefined || isStringArray(value);
}

function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === 'string';
}

function isOptionalObsidianToolsSettings(value: unknown): value is ObsidianToolsSettings | undefined {
  if (value === undefined) {
    return true;
  }

  if (!isRecord(value)) {
    return false;
  }

  return typeof value.cliEnabled === 'boolean'
    && (typeof value.cliPath === 'string' || value.cliPath === null || value.cliPath === undefined)
    && typeof value.cliTimeoutMs === 'number'
    && typeof value.allowCommand === 'boolean'
    && isStringArray(value.commandAllowlist)
    && typeof value.allowEval === 'boolean';
}

export function isPiAgentSettings(value: unknown): value is PiAgentSettings {
  if (!isRecord(value)) {
    return false;
  }

  return typeof value.environmentVariables === 'string'
    && typeof value.selectedMode === 'string'
    && isStringArray(value.visibleModels)
    && isOptionalStringArray(value.addedProviders)
    && isOptionalStringArray(value.disabledProviders)
    && isOptionalString(value.lastModel)
    && isOptionalString(value.environmentHash)
    && isOptionalObsidianToolsSettings(value.obsidianTools);
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

  // Security
  permissionMode: PermissionMode;

  // Model & thinking (provider interprets values)
  model: string;
  thinkingBudget: string;
  thinkingLevel: string;
  enableAutoTitleGeneration: boolean;
  titleGenerationModel: string;

  // Content settings
  excludedTags: string[];
  persistentExternalContextPaths: string[];

  // Environment
  sharedEnvironmentVariables: string;
  envSnippets: EnvSnippet[];
  customContextLimits: Record<string, number>;

  // UI settings
  keyboardNavigation: KeyboardNavigationSettings;
  requireCommandOrControlEnterToSend: boolean;

  // Internationalization
  locale: string;

  // Agent runtime settings (Pi providers, credentials, model pool)
  agentSettings: PiAgentSettings;

  // State (provider-specific, round-tripped opaquely)
  lastCustomModel?: string;

  // UI preferences
  maxTabs: number;
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

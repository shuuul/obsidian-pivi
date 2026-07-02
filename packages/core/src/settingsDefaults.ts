import type { PiviSettings } from "./settings";

/** Default pi-ai environment string for fresh installs. */
export const PI_DEFAULT_ENVIRONMENT_VARIABLES = "PI_ENABLE_EXA=1";

/** Primary model key for new vaults (`PiviSettings.model` and `agentSettings.visibleModels`). */
export const DEFAULT_MODEL_KEY = "opencode-go/deepseek-v4-flash";

/** Providers Pivi exposes by default on fresh installs. */
export const DEFAULT_PI_PROVIDER_IDS = [
  "opencode-go",
  "deepseek",
  "openai-codex",
] as const;

/** Persisted agent defaults when `agentSettings` is missing or repaired on load. */
export const DEFAULT_AGENT_SETTINGS = Object.freeze({
  addedProviders: [...DEFAULT_PI_PROVIDER_IDS],
  environmentVariables: PI_DEFAULT_ENVIRONMENT_VARIABLES,
  selectedMode: "default",
  visibleModels: [DEFAULT_MODEL_KEY],
});

export const DEFAULT_PIVI_SETTINGS: PiviSettings = {
  userName: "",
  permissionMode: "normal",
  model: DEFAULT_MODEL_KEY,
  thinkingBudget: "off",
  thinkingLevel: "medium",
  enableAutoTitleGeneration: true,
  titleGenerationModel: "",
  excludedTags: [],
  persistentExternalContextPaths: [],
  sharedEnvironmentVariables: "",
  customContextLimits: {},
  keyboardNavigation: {
    scrollUpKey: "w",
    scrollDownKey: "s",
    focusInputKey: "i",
  },
  requireCommandOrControlEnterToSend: false,
  locale: "en",
  agentSettings: { ...DEFAULT_AGENT_SETTINGS },
  tabBarPosition: "input",
  enableAutoScroll: true,
  deferMathRenderingDuringStreaming: true,
  chatViewPlacement: "right-sidebar",
  hiddenSlashCommands: [],
};

/** Option for model, reasoning, or other UI selectors. */
export interface ChatUIOption {
  value: string;
  label: string;
  description?: string;
  /** Optional group label for visual separators in dropdowns. */
  group?: string;
  /** Provider icon slug used to select a bundled/local fallback icon. */
  providerLogoSlug?: string;
  /** Lucide icon when no brand slug is available. */
  fallbackIcon?: string;
}

/** Icon descriptor for the chat header: the Pivi brand mark from the bundled SVG asset. */
export interface ChatIconSvg {
  kind: 'pivi-brand';
  viewBox: string;
}

/** Extended option with token count for budget-based reasoning controls. */
export interface ChatReasoningOption extends ChatUIOption {
  tokens?: number;
}

/** Static Pi chat UI configuration (models, reasoning, context window). */
export interface ChatUIConfig {
  /** Model options for the selector dropdown. */
  getModelOptions(settings: Record<string, unknown>): ChatUIOption[];

  /** Whether the model uses adaptive reasoning (effort levels vs token budgets). */
  isAdaptiveReasoningModel(model: string, settings: Record<string, unknown>): boolean;

  /** Reasoning options for the current model (effort levels if adaptive, budgets otherwise). */
  getReasoningOptions(model: string, settings: Record<string, unknown>): ChatReasoningOption[];

  /** Default reasoning value for the model. */
  getDefaultReasoningValue(model: string, settings: Record<string, unknown>): string;

  /** Context window size in tokens, or null when the selected model has no known limit. */
  getContextWindowSize(model: string, customLimits?: Record<string, number>): number | null;

  /** Apply model change side effects to settings. */
  applyModelDefaults(model: string, settings: unknown): void;

  /** Optional hook when the toolbar changes a reasoning selection. */
  applyReasoningSelection?(model: string, value: string, settings: unknown): void;

  /** SVG icon for the chat UI (shown next to model names in selectors). */
  getChatIcon?(): ChatIconSvg | null;
}

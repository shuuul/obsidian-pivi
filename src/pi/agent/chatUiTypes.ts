import type { AgentHostContext } from '../bootstrap/hostContext';

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
  /** Per-option icon override for grouped selector entries. */
  chatIcon?: ChatIconSvg;
}

export interface ChatPathIconSvg {
  kind?: 'path';
  viewBox: string;
  path: string;
}

export interface ChatSvgPathChild {
  tag: 'path';
  attributes: Record<string, string>;
}

export interface ChatSvgGroupChild {
  tag: 'g';
  attributes: Record<string, string>;
  children: ChatSvgPathChild[];
}

export type ChatSvgChild = ChatSvgGroupChild | ChatSvgPathChild;

export interface ChatCompositeIconSvg {
  kind: 'composite';
  viewBox: string;
  children: ChatSvgChild[];
}

/** Mask-based Pivi p icon (matches ribbon `pivi-p` orientation). */
export interface ChatPiviBrandIconSvg {
  kind: 'pivi-brand';
  viewBox: string;
}

/** SVG icon descriptor for chat toolbar and model selectors. */
export type ChatIconSvg = ChatPathIconSvg | ChatCompositeIconSvg | ChatPiviBrandIconSvg;

/** Extended option with token count for budget-based reasoning controls. */
export interface ChatReasoningOption extends ChatUIOption {
  tokens?: number;
}

/** Compact permission-mode toggle descriptor for providers that expose the current toolbar control. */
export interface ChatPermissionModeToggleConfig {
  inactiveValue: string;
  inactiveLabel: string;
  activeValue: string;
  activeLabel: string;
  planValue?: string;
  planLabel?: string;
}

export interface ChatModeSelectorConfig {
  activeValue?: string;
  label: string;
  options: ChatUIOption[];
  value: string;
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

  /** Context window size in tokens. */
  getContextWindowSize(model: string, customLimits?: Record<string, number>): number;

  /** Whether this is the built-in default model. */
  isDefaultModel(model: string): boolean;

  /** Apply model change side effects to settings. */
  applyModelDefaults(model: string, settings: unknown): void;

  /** Optional hook to discover model-scoped metadata after a model is selected. */
  prepareModelMetadata?(
    model: string,
    settings: Record<string, unknown>,
    context: { host: AgentHostContext },
  ): Promise<void>;

  /** Optional hook when the toolbar changes a reasoning selection. */
  applyReasoningSelection?(model: string, value: string, settings: unknown): void;

  /** Optional permission-mode toggle descriptor. Return null when no permission toggle UI is exposed. */
  getPermissionModeToggle?(): ChatPermissionModeToggleConfig | null;

  /** Optional mapping back into the shared permission-mode contract. */
  resolvePermissionMode?(settings: Record<string, unknown>): string | null;

  /** Optional hook when the toolbar changes permission mode. */
  applyPermissionMode?(value: string, settings: unknown): void;

  /** Optional mode selector descriptor. */
  getModeSelector?(settings: Record<string, unknown>): ChatModeSelectorConfig | null;

  /** Optional hook when the toolbar changes a Pi-owned mode selection. */
  applyModeSelection?(value: string, settings: unknown): void;

  /** SVG icon for the chat UI (shown next to model names in selectors). */
  getChatIcon?(): ChatIconSvg | null;
}

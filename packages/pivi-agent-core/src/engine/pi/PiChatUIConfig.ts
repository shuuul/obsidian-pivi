import type {
  ChatReasoningOption,
  ChatUIConfig,
  ChatUIOption,
} from '../../foundation';
import { getPiAgentSettings } from '../../foundation/agentSettings';
import { piAiModels } from './PiAiModels';
import {
  buildPiModelOptions,
  cachePiAiRegistryModels,
  resolvePiModelFromKeyWithLookup,
} from './PiModelRegistry';
import {
  getPiDefaultThinkingLevelForModel,
  getPiThinkingLevelOptionsForModel,
  isPiAdaptiveReasoningModelValue,
} from './PiThinkingLevels';

export function warmPiAiModelsCache() {
  try {
    cachePiAiRegistryModels(piAiModels);
  } catch (err) {
    console.error('Failed to warm pi-ai models cache:', err);
  }
}

const DEFAULT_CONTEXT_WINDOW = 200_000;

export const piChatUIConfig: ChatUIConfig = {
  getModelOptions(settings): ChatUIOption[] {
    const piSettings = getPiAgentSettings(settings);
    return buildPiModelOptions({
      visibleModels: piSettings.visibleModels,
      disabledProviders: piSettings.disabledProviders,
      addedProviders: piSettings.addedProviders,
    });
  },

  isAdaptiveReasoningModel(model: string, _settings: Record<string, unknown>): boolean {
    return isPiAdaptiveReasoningModelValue(resolvePiModelFromKeyWithLookup(model, piAiModels));
  },

  getReasoningOptions(model: string, _settings: Record<string, unknown>): ChatReasoningOption[] {
    return getPiThinkingLevelOptionsForModel(resolvePiModelFromKeyWithLookup(model, piAiModels));
  },

  getDefaultReasoningValue(model: string, settings: Record<string, unknown>): string {
    const current =
      typeof settings.thinkingLevel === 'string'
        ? settings.thinkingLevel
        : typeof settings.effortLevel === 'string'
          ? settings.effortLevel
          : undefined;
    return getPiDefaultThinkingLevelForModel(resolvePiModelFromKeyWithLookup(model, piAiModels), current);
  },

  getContextWindowSize(model: string, customLimits?: Record<string, number>): number {
    return customLimits?.[model] ?? DEFAULT_CONTEXT_WINDOW;
  },

  isDefaultModel(model: string): boolean {
    return model === 'opencode-go/deepseek-v4-flash';
  },

  applyModelDefaults(model: string, settings: unknown): void {
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
      return;
    }
    const settingsBag = settings as Record<string, unknown>;
    settingsBag.model = model;
  },

  applyReasoningSelection(_model: string, value: string, settings: unknown): void {
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
      return;
    }
    const bag = settings as Record<string, unknown>;
    bag.thinkingLevel = value;
    delete bag.effortLevel;
  },

  getPermissionModeToggle() {
    return null;
  },

  resolvePermissionMode(settings: Record<string, unknown>): string | null {
    const mode = settings.permissionMode as string | undefined;
    if (mode === 'plan' || mode === 'normal') {
      return mode;
    }
    return 'normal';
  },

  applyPermissionMode(value: string, settings: unknown): void {
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
      return;
    }
    const settingsBag = settings as Record<string, unknown>;
    settingsBag.permissionMode = value;
  },

  getChatIcon() {
    return { kind: 'pivi-brand', viewBox: '0 0 100 100' };
  },
};

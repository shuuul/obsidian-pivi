import { PluginLogger } from '@pivi/agent/logging/pluginLogger';
import type { ChatReasoningOption, ChatUIConfig, ChatUIOption } from '@pivi/agent/runtime';
import { getPiAgentSettings } from '@pivi/agent/settings/agentSettings';
import { DEFAULT_MODEL_KEY } from '@pivi/agent/settings/defaults';
import { getLogoSlugForCustomProviderKind } from '@pivi/agent/settings/modelDisplay';

import { piAiModels } from './piAiModels';
import {
  buildPiModelOptions,
  cachePiAiRegistryModels,
  resolvePiModelFromKeyWithLookup,
} from './piModelRegistry';
import {
  getPiDefaultThinkingLevelForModel,
  getPiThinkingLevelOptionsForModel,
  isPiAdaptiveReasoningModelValue,
} from './piThinkingLevels';

const logger = new PluginLogger('PiChatUiConfig');

export function warmPiAiModelsCache() {
  try {
    cachePiAiRegistryModels(piAiModels);
  } catch (err) {
    logger.error('Failed to warm pi-ai models cache', err);
  }
}

export const piChatUIConfig: ChatUIConfig = {
  getModelOptions(settings): ChatUIOption[] {
    const piSettings = getPiAgentSettings(settings);
    const providerDisplayNames = Object.fromEntries(
      piSettings.customProviders.map((provider) => [provider.id, provider.name]),
    );
    const providerLogoSlugs: Record<string, string> = {};
    for (const provider of piSettings.customProviders) {
      const slug = getLogoSlugForCustomProviderKind(provider.kind);
      if (slug) {
        providerLogoSlugs[provider.id] = slug;
      }
    }
    return buildPiModelOptions({
      visibleModels: piSettings.visibleModels,
      disabledProviders: piSettings.disabledProviders,
      addedProviders: piSettings.addedProviders,
      providerDisplayNames,
      providerLogoSlugs,
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

  getContextWindowSize(model: string, customLimits?: Record<string, number>): number | null {
    return customLimits?.[model]
      ?? resolvePiModelFromKeyWithLookup(model, piAiModels)?.contextWindow
      ?? null;
  },

  isDefaultModel(model: string): boolean {
    return model === DEFAULT_MODEL_KEY;
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

  getChatIcon() {
    return { kind: 'pivi-brand', viewBox: '0 0 512 512' };
  },
};

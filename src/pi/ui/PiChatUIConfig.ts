import * as piAi from '@earendil-works/pi-ai';
import type { Api, Model } from '@earendil-works/pi-ai';

import type {
  ChatReasoningOption,
  ChatUIConfig,
  ChatUIOption,
} from '../../core/agent/types';
import { PI_CHAT_ICON } from '../../shared/icons';
import { preloadProviderLogos } from '../../shared/providerLogo';
import { formatContextLimit } from '../../utils/env';
import { isProviderDisabled } from '../auth/ProviderSecretStorage';
import { getPiAgentSettings } from '../settings';
import {
  getPiDefaultThinkingLevel,
  getPiThinkingLevelOptions,
  isPiAdaptiveReasoningModel,
} from './piThinkingLevels';
import {
  collectProviderLogoSlugs,
  getModelFallbackLucideIcon,
  getProviderDisplayName,
  getProviderIdFromModelValue,
  getProviderLogoSlug,
  getProviderLogoSlugFromModelValue,
} from './providerLogos';

/** Cached pi-ai registry models keyed by `provider/modelId`. */
export type PiCachedModel = Model<Api>;

export const PI_AI_MODELS_CACHE = new Map<string, PiCachedModel>();

export async function warmPiAiModelsCache() {
  try {
    piAi.registerBuiltInApiProviders();
    const providers = piAi.getProviders();
    for (const prov of providers) {
      const models = piAi.getModels(prov);
      for (const m of models) {
        PI_AI_MODELS_CACHE.set(`${prov}/${m.id}`, m);
      }
    }
    preloadProviderLogos(collectProviderLogoSlugs(providers));
  } catch (err) {
    console.error('Failed to warm pi-ai models cache:', err);
  }
}

export function getPiAiModelsForProvider(providerId: string): { label: string, value: string, description: string }[] {
  const result: { label: string, value: string, description: string }[] = [];
  
  for (const [key, model] of PI_AI_MODELS_CACHE.entries()) {
    if (model.provider === providerId) {
      result.push({
        value: key,
        label: model.name,
        description: `${model.reasoning ? 'Reasoning model' : 'Standard model'} (context: ${formatContextLimit(model.contextWindow)})`
      });
    }
  }
  
  return result.sort((a, b) => a.label.localeCompare(b.label));
}

const DEFAULT_CONTEXT_WINDOW = 200_000;

export const piChatUIConfig: ChatUIConfig = {
  getModelOptions(settings): ChatUIOption[] {
    const piSettings = getPiAgentSettings(settings);
    const visible = piSettings.visibleModels;
    const disabledProviders = piSettings.disabledProviders;

    const options: ChatUIOption[] = [];

    for (const modelVal of visible) {
      const providerId = getProviderIdFromModelValue(modelVal);
      if (providerId && isProviderDisabled(disabledProviders, providerId)) {
        continue;
      }
      let label = modelVal;
      let description = 'Pi-supported model';

      const cached = PI_AI_MODELS_CACHE.get(modelVal);
      if (cached) {
        label = cached.name;
        description = `${cached.reasoning ? 'Reasoning model' : 'Standard model'} (context: ${formatContextLimit(cached.contextWindow)})`;
      } else {
        const parts = modelVal.split('/');
        if (parts.length > 1) {
          const modelId = parts.slice(1).join('/');
          label = modelId.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
        }
      }

      const modelProviderId = getProviderIdFromModelValue(modelVal);
      options.push({
        value: modelVal,
        label,
        description,
        group: modelProviderId ? getProviderDisplayName(modelProviderId) : undefined,
        providerLogoSlug: getProviderLogoSlugFromModelValue(modelVal) ?? undefined,
        fallbackIcon: getModelFallbackLucideIcon(modelVal, label),
      });
    }

    if (options.length === 0) {
      // Prefer a model from a provider the user has actually added
      const addedProviders = piSettings.addedProviders;
      let fallbackKey: string | null = null;
      let fallbackModel: PiCachedModel | null = null;

      for (const providerId of addedProviders) {
        if (isProviderDisabled(disabledProviders, providerId)) {
          continue;
        }
        for (const [key, model] of PI_AI_MODELS_CACHE.entries()) {
          if (model.provider === providerId) {
            fallbackKey = key;
            fallbackModel = model;
            break;
          }
        }
        if (fallbackKey) break;
      }

      if (!fallbackKey) {
        const firstCached = PI_AI_MODELS_CACHE.entries().next().value;
        if (firstCached) {
          [fallbackKey, fallbackModel] = firstCached;
        }
      }

      if (fallbackKey && fallbackModel) {
        const fallbackLabel = fallbackModel.name ?? fallbackKey;
        const fallbackProviderId = getProviderIdFromModelValue(fallbackKey);
        options.push({
          value: fallbackKey,
          label: fallbackLabel,
          description: `${fallbackModel.reasoning ? 'Reasoning model' : 'Standard model'} (context: ${formatContextLimit(fallbackModel.contextWindow)})`,
          group: fallbackProviderId ? getProviderDisplayName(fallbackProviderId) : undefined,
          providerLogoSlug: getProviderLogoSlugFromModelValue(fallbackKey) ?? undefined,
          fallbackIcon: getModelFallbackLucideIcon(fallbackKey, fallbackLabel),
        });
      } else {
        const defaultValue = 'anthropic/claude-sonnet-4-20250514';
        options.push({
          value: defaultValue,
          label: 'Claude Sonnet 4',
          description: 'Default model (no models in pool)',
          group: getProviderDisplayName('anthropic'),
          providerLogoSlug: getProviderLogoSlug('anthropic') ?? undefined,
          fallbackIcon: getModelFallbackLucideIcon(defaultValue, 'Claude Sonnet 4'),
        });
      }
    }

    options.sort((a, b) => {
      const groupCmp = (a.group ?? '').localeCompare(b.group ?? '');
      if (groupCmp !== 0) {
        return groupCmp;
      }
      return a.label.localeCompare(b.label);
    });

    preloadProviderLogos(
      options
        .map((o) => o.providerLogoSlug)
        .filter((slug): slug is string => !!slug),
    );

    return options;
  },

  ownsModel(model: string): boolean {
    return model.length > 0;
  },

  isAdaptiveReasoningModel(model: string, _settings: Record<string, unknown>): boolean {
    return isPiAdaptiveReasoningModel(model);
  },

  getReasoningOptions(model: string, _settings: Record<string, unknown>): ChatReasoningOption[] {
    return getPiThinkingLevelOptions(model);
  },

  getDefaultReasoningValue(model: string, settings: Record<string, unknown>): string {
    const current =
      typeof settings.thinkingLevel === 'string'
        ? settings.thinkingLevel
        : typeof settings.effortLevel === 'string'
          ? settings.effortLevel
          : undefined;
    return getPiDefaultThinkingLevel(model, current);
  },

  getContextWindowSize(model: string, customLimits?: Record<string, number>): number {
    return customLimits?.[model] ?? DEFAULT_CONTEXT_WINDOW;
  },

  isDefaultModel(model: string): boolean {
    return model === 'anthropic/claude-sonnet-4-20250514';
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

  normalizeModelVariant(model: string, settings: Record<string, unknown>): string {
    return model;
  },

  getCustomModelIds(): Set<string> {
    return new Set<string>();
  },

  getModeSelector(): null {
    return null;
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
    return PI_CHAT_ICON;
  },
};

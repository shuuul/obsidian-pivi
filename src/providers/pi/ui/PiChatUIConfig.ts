import * as piAi from '@earendil-works/pi-ai';

import type {
  ProviderChatUIConfig,
  ProviderPermissionModeToggleConfig,
  ProviderReasoningOption,
  ProviderUIOption,
} from '../../../core/providers/types';
import { PI_PROVIDER_ICON } from '../../../shared/icons';
import { formatContextLimit } from '../../../utils/env';
import { getPiProviderSettings } from '../settings';

export const PI_AI_MODELS_CACHE = new Map<string, any>();

export async function warmPiAiModelsCache() {
  try {
    const p = piAi as any;
    p.registerBuiltInApiProviders();
    const providers = p.getProviders() as string[];
    for (const prov of providers) {
      const models = p.getModels(prov) as any[];
      for (const m of models) {
        PI_AI_MODELS_CACHE.set(`${prov}/${m.id}`, m);
      }
    }
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

const PI_PERMISSION_MODE_TOGGLE: ProviderPermissionModeToggleConfig = {
  inactiveValue: 'normal',
  inactiveLabel: 'Safe',
  activeValue: 'yolo',
  activeLabel: 'YOLO',
  planValue: 'plan',
  planLabel: 'Plan',
};

export const piChatUIConfig: ProviderChatUIConfig = {
  getModelOptions(settings): ProviderUIOption[] {
    const piSettings = getPiProviderSettings(settings);
    const visible = piSettings.visibleModels;

    const options: ProviderUIOption[] = [];

    for (const modelVal of visible) {
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

      options.push({
        value: `pi:${modelVal}`,
        label,
        description,
      });
    }

    if (options.length === 0) {
      // Prefer a model from a provider the user has actually added
      const addedProviders = piSettings.addedProviders;
      let fallbackKey: string | null = null;
      let fallbackModel: any = null;

      for (const providerId of addedProviders) {
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
        options.push({
          value: `pi:${fallbackKey}`,
          label: fallbackModel.name ?? fallbackKey,
          description: `${fallbackModel.reasoning ? 'Reasoning model' : 'Standard model'} (context: ${formatContextLimit(fallbackModel.contextWindow)})`,
        });
      } else {
        options.push({ value: 'pi:anthropic/claude-sonnet-4-20250514', label: 'Claude Sonnet 4', description: 'Default model (no models in pool)' });
      }
    }

    return options;
  },

  ownsModel(model: string): boolean {
    return model.startsWith('pi:');
  },

  isAdaptiveReasoningModel(model: string, settings: Record<string, unknown>): boolean {
    return false;
  },

  getReasoningOptions(model: string, settings: Record<string, unknown>): ProviderReasoningOption[] {
    return [];
  },

  getDefaultReasoningValue(model: string, settings: Record<string, unknown>): string {
    return 'none';
  },

  getContextWindowSize(model: string, customLimits?: Record<string, number>): number {
    return customLimits?.[model] ?? DEFAULT_CONTEXT_WINDOW;
  },

  isDefaultModel(model: string): boolean {
    return model === 'pi:anthropic/claude-sonnet-4-20250514';
  },

  applyModelDefaults(model: string, settings: unknown): void {
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
      return;
    }
    const settingsBag = settings as Record<string, unknown>;
    settingsBag.model = model;
  },

  applyReasoningSelection(model: string, value: string, settings: unknown): void {
    // No-op for Pi
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

  getPermissionModeToggle(): ProviderPermissionModeToggleConfig {
    return PI_PERMISSION_MODE_TOGGLE;
  },

  resolvePermissionMode(settings: Record<string, unknown>): string | null {
    return (settings.permissionMode as string | undefined) ?? 'yolo';
  },

  applyPermissionMode(value: string, settings: unknown): void {
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
      return;
    }
    const settingsBag = settings as Record<string, unknown>;
    settingsBag.permissionMode = value;
  },

  getProviderIcon() {
    return PI_PROVIDER_ICON;
  },
};

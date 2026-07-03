import type { Api, Model } from '@earendil-works/pi-ai';

import type { ChatUIOption } from '../../foundation';
import {
  getModelFallbackLucideIcon,
  getProviderDisplayName,
  getProviderIdFromModelValue,
  getProviderLogoSlug,
  getProviderLogoSlugFromModelValue,
} from '../../foundation/providerLogos';
import { formatContextLimit } from '../../foundation/settingsEnv';

/** Model shape from the pi-ai registry and warm cache. */
export type PiCachedModel = Model<Api>;

export type PiResolvedModel = PiCachedModel;

export interface PiModelLookup {
  getModel(provider: string, modelId: string): PiCachedModel | null | undefined;
}

export interface PiModelRegistryProvider {
  getProviders(): readonly { id: string }[];
  getModels(providerId: string): readonly PiCachedModel[];
}

export interface PiModelOption {
  label: string;
  value: string;
  description: string;
}

export interface BuildPiModelOptionsInput {
  visibleModels: readonly string[];
  disabledProviders?: readonly string[];
  addedProviders?: readonly string[];
  defaultModelKey?: string;
}

const DEFAULT_PI_MODEL_KEY = 'opencode-go/deepseek-v4-flash';
const DEFAULT_PI_MODEL_LABEL = 'DeepSeek V4 Flash';
const DEFAULT_PI_MODEL_PROVIDER = 'opencode-go';

function formatPiModelDescription(model: PiCachedModel): string {
  return `${model.reasoning ? 'Reasoning model' : 'Standard model'} (context: ${formatContextLimit(model.contextWindow)})`;
}

function isProviderDisabled(disabledProviders: readonly string[] | undefined, providerId: string): boolean {
  return disabledProviders?.includes(providerId) ?? false;
}

function titleizeModelId(modelValue: string): string {
  const parts = modelValue.split('/');
  if (parts.length <= 1) {
    return modelValue;
  }
  return parts
    .slice(1)
    .join('/')
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function optionFromModelKey(modelKey: string, cached: PiCachedModel | undefined): ChatUIOption {
  const label = cached?.name ?? titleizeModelId(modelKey);
  const providerId = getProviderIdFromModelValue(modelKey);
  return {
    value: modelKey,
    label,
    description: cached ? formatPiModelDescription(cached) : 'Pi-supported model',
    group: providerId ? getProviderDisplayName(providerId) : undefined,
    providerLogoSlug: getProviderLogoSlugFromModelValue(modelKey) ?? undefined,
    fallbackIcon: getModelFallbackLucideIcon(modelKey, label),
  };
}

function findFallbackCachedModel(
  addedProviders: readonly string[],
  disabledProviders: readonly string[] | undefined,
): [string, PiCachedModel] | null {
  for (const providerId of addedProviders) {
    if (isProviderDisabled(disabledProviders, providerId)) {
      continue;
    }
    for (const [key, model] of PI_AI_MODELS_CACHE.entries()) {
      if (model.provider === providerId) {
        return [key, model];
      }
    }
  }

  return PI_AI_MODELS_CACHE.entries().next().value ?? null;
}

function defaultFallbackOption(defaultModelKey: string): ChatUIOption {
  return {
    value: defaultModelKey,
    label: DEFAULT_PI_MODEL_LABEL,
    description: 'Default model (no models in pool)',
    group: getProviderDisplayName(DEFAULT_PI_MODEL_PROVIDER),
    providerLogoSlug: getProviderLogoSlug(DEFAULT_PI_MODEL_PROVIDER) ?? undefined,
    fallbackIcon: getModelFallbackLucideIcon(defaultModelKey, DEFAULT_PI_MODEL_LABEL),
  };
}

/** Cached pi-ai registry models keyed by `provider/modelId`. */
export const PI_AI_MODELS_CACHE = new Map<string, PiCachedModel>();

export function cachePiAiRegistryModels(registry: PiModelRegistryProvider): void {
  const providers = registry.getProviders();
  for (const provider of providers) {
    const models = registry.getModels(provider.id);
    for (const model of models) {
      PI_AI_MODELS_CACHE.set(`${provider.id}/${model.id}`, model);
    }
  }
}

export function getPiAiModelsForProvider(providerId: string): PiModelOption[] {
  const result: PiModelOption[] = [];

  for (const [key, model] of PI_AI_MODELS_CACHE.entries()) {
    if (model.provider === providerId) {
      result.push({
        value: key,
        label: model.name,
        description: `${model.reasoning ? 'Reasoning model' : 'Standard model'} (context: ${formatContextLimit(model.contextWindow)})`,
      });
    }
  }

  return result.sort((a, b) => a.label.localeCompare(b.label));
}

export function buildPiModelOptions(input: BuildPiModelOptionsInput): ChatUIOption[] {
  const options: ChatUIOption[] = [];

  for (const modelKey of input.visibleModels) {
    const providerId = getProviderIdFromModelValue(modelKey);
    if (providerId && isProviderDisabled(input.disabledProviders, providerId)) {
      continue;
    }
    options.push(optionFromModelKey(modelKey, PI_AI_MODELS_CACHE.get(modelKey)));
  }

  if (options.length === 0) {
    const fallback = findFallbackCachedModel(input.addedProviders ?? [], input.disabledProviders);
    if (fallback) {
      const [fallbackKey, fallbackModel] = fallback;
      options.push(optionFromModelKey(fallbackKey, fallbackModel));
    } else {
      options.push(defaultFallbackOption(input.defaultModelKey ?? DEFAULT_PI_MODEL_KEY));
    }
  }

  return options.sort((a, b) => {
    const groupCmp = (a.group ?? '').localeCompare(b.group ?? '');
    if (groupCmp !== 0) {
      return groupCmp;
    }
    return a.label.localeCompare(b.label);
  });
}

/** Resolve a `provider/modelId` key via cache or an injected pi-ai registry lookup. */
export function resolvePiModelFromKeyWithLookup(
  modelKey: string,
  lookup: PiModelLookup,
): PiResolvedModel | null {
  const cached = PI_AI_MODELS_CACHE.get(modelKey);
  if (cached) {
    return cached;
  }

  const slashIndex = modelKey.indexOf('/');
  if (slashIndex <= 0) {
    return null;
  }

  try {
    const provider = modelKey.substring(0, slashIndex);
    const modelId = modelKey.substring(slashIndex + 1);
    return lookup.getModel(provider, modelId) ?? null;
  } catch {
    return null;
  }
}

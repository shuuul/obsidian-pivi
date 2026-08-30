import type { Api, Model } from '@earendil-works/pi-ai';
import type { ChatUIOption } from '@pivi/agent/runtime';
import { DEFAULT_MODEL_KEY } from '@pivi/agent/settings/defaults';
import { formatContextLimit } from '@pivi/agent/settings/environmentText';
import {
  getModelFallbackLucideIcon,
  getModelFamilyLogoSlug,
  getModelIdFromModelValue,
  getProviderDisplayName,
  getProviderIdFromModelValue,
  getProviderLogoSlug,
  getProviderLogoSlugFromModelValue,
} from '@pivi/agent/settings/modelDisplay';

/** Model shape from the pi-ai registry and warm cache. */
export type PiCachedModel = Model<Api> & {
  /** False when a custom provider is using Pivi's synthetic fallback window. */
  contextWindowIsAuthoritative?: boolean;
  /** Server-advertised default thinking level; overrides pi-ai's `medium` fallback. */
  defaultThinkingLevel?: 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';
};

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
  /** Model key → user-configured context window used by runtime and UI. */
  customContextLimits?: Readonly<Record<string, number>>;
  /** Custom provider id → Settings display name for composer group labels. */
  providerDisplayNames?: Readonly<Record<string, string>>;
  /** Custom provider id → bundled logo slug (kind-based; ids are not in PROVIDER_ID_TO_SLUG). */
  providerLogoSlugs?: Readonly<Record<string, string>>;
}

const DEFAULT_PI_MODEL_KEY = DEFAULT_MODEL_KEY;
const DEFAULT_PI_MODEL_LABEL = 'DeepSeek Chat';
const DEFAULT_PI_MODEL_PROVIDER = 'deepseek';

function formatPiModelDescription(model: PiCachedModel, contextWindow = model.contextWindow): string {
  return `${model.reasoning ? 'Reasoning model' : 'Standard model'} (context: ${formatContextLimit(contextWindow)})`;
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

function optionFromModelKey(
  modelKey: string,
  cached: PiCachedModel | undefined,
  input: Pick<
    BuildPiModelOptionsInput,
    'customContextLimits' | 'providerDisplayNames' | 'providerLogoSlugs'
  >,
): ChatUIOption {
  const label = cached?.name ?? titleizeModelId(modelKey);
  const providerId = getProviderIdFromModelValue(modelKey);
  const modelId = getModelIdFromModelValue(modelKey);
  return {
    value: modelKey,
    label,
    description: cached
      ? formatPiModelDescription(cached, input.customContextLimits?.[modelKey] ?? cached.contextWindow)
      : 'Pi-supported model',
    group: providerId ? getProviderDisplayName(providerId, input.providerDisplayNames) : undefined,
    providerLogoSlug:
      getModelFamilyLogoSlug(modelId, label)
      ?? (providerId ? input.providerLogoSlugs?.[providerId] : undefined)
      ?? getProviderLogoSlugFromModelValue(modelKey)
      ?? undefined,
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
  const nextModels = new Map<string, PiCachedModel>();
  const providers = registry.getProviders();
  for (const provider of providers) {
    const models = registry.getModels(provider.id);
    for (const model of models) {
      nextModels.set(`${provider.id}/${model.id}`, model);
    }
  }

  PI_AI_MODELS_CACHE.clear();
  for (const [modelKey, model] of nextModels) {
    PI_AI_MODELS_CACHE.set(modelKey, model);
  }
}

export function isPiModelContextWindowAuthoritative(
  model: PiCachedModel | null | undefined,
): boolean {
  return Boolean(model?.contextWindow) && model?.contextWindowIsAuthoritative !== false;
}

export function getPiAiModelsForProvider(
  providerId: string,
  customContextLimits?: Readonly<Record<string, number>>,
): PiModelOption[] {
  const result: PiModelOption[] = [];

  for (const [key, model] of PI_AI_MODELS_CACHE.entries()) {
    if (model.provider === providerId) {
      result.push({
        value: key,
        label: model.name,
        description: formatPiModelDescription(model, customContextLimits?.[key] ?? model.contextWindow),
      });
    }
  }

  return result.sort((a, b) => a.label.localeCompare(b.label));
}

/** Built-in catalog rows available for custom-model compatibility matching. */
export function getPiAiCatalogModels(
  excludedProviderIds: ReadonlySet<string>,
): PiModelOption[] {
  const result: PiModelOption[] = [];

  for (const [key, model] of PI_AI_MODELS_CACHE.entries()) {
    if (excludedProviderIds.has(model.provider)) {
      continue;
    }
    result.push({
      value: key,
      label: model.name,
      description: formatPiModelDescription(model),
    });
  }

  return result.sort((a, b) => a.value.localeCompare(b.value));
}

export function buildPiModelOptions(input: BuildPiModelOptionsInput): ChatUIOption[] {
  const options: ChatUIOption[] = [];
  const providerOrder = new Map(
    (input.addedProviders ?? []).map((providerId, index) => [providerId, index]),
  );

  for (const modelKey of input.visibleModels) {
    const providerId = getProviderIdFromModelValue(modelKey);
    if (providerId && isProviderDisabled(input.disabledProviders, providerId)) {
      continue;
    }
    options.push(optionFromModelKey(modelKey, PI_AI_MODELS_CACHE.get(modelKey), input));
  }

  if (options.length === 0) {
    const fallback = findFallbackCachedModel(input.addedProviders ?? [], input.disabledProviders);
    if (fallback) {
      const [fallbackKey, fallbackModel] = fallback;
      options.push(optionFromModelKey(fallbackKey, fallbackModel, input));
    } else {
      options.push(defaultFallbackOption(input.defaultModelKey ?? DEFAULT_PI_MODEL_KEY));
    }
  }

  return options.sort((a, b) => {
    const aProvider = getProviderIdFromModelValue(a.value);
    const bProvider = getProviderIdFromModelValue(b.value);
    const aProviderIndex = aProvider === null
      ? Number.MAX_SAFE_INTEGER
      : (providerOrder.get(aProvider) ?? Number.MAX_SAFE_INTEGER);
    const bProviderIndex = bProvider === null
      ? Number.MAX_SAFE_INTEGER
      : (providerOrder.get(bProvider) ?? Number.MAX_SAFE_INTEGER);
    if (aProviderIndex !== bProviderIndex) {
      return aProviderIndex - bProviderIndex;
    }
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

/** Reconcile persisted visible-model keys against the current custom-provider model lists. */

import type {
  CustomProviderConfig,
} from './customProviders';

export function providerIdFromModelKey(modelKey: string): string | null {
  const slashIndex = modelKey.indexOf('/');
  if (slashIndex <= 0) {
    return null;
  }
  return modelKey.slice(0, slashIndex);
}

/**
 * Drop stale `providerId/modelId` keys for custom providers whose id is no
 * longer in `provider.models`. When every checked key for a provider was
 * stale and the catalog still has models, replace them with the current
 * config ids. An empty provider slice (intentionally unchecked) is left empty.
 */
export function reconcileVisibleModelsForCustomProviders(
  visibleModels: readonly string[],
  customProviders: readonly Pick<CustomProviderConfig, 'id' | 'models'>[],
): string[] {
  if (customProviders.length === 0) {
    return [...visibleModels];
  }

  const providersById = new Map(
    customProviders.map((provider) => [provider.id, provider]),
  );
  const allowedIdsByProvider = new Map<string, Set<string>>();
  for (const provider of customProviders) {
    allowedIdsByProvider.set(
      provider.id,
      new Set(provider.models.map((model) => model.id)),
    );
  }

  const hadKeys = new Set<string>();
  const droppedStale = new Set<string>();
  const remaining = new Set<string>();
  const firstDropIndex = new Map<string, number>();

  visibleModels.forEach((modelKey, index) => {
    const providerId = providerIdFromModelKey(modelKey);
    if (!providerId || !providersById.has(providerId)) {
      return;
    }
    hadKeys.add(providerId);
    const modelId = modelKey.slice(providerId.length + 1);
    const allowed = allowedIdsByProvider.get(providerId);
    if (allowed?.has(modelId)) {
      remaining.add(providerId);
      return;
    }
    droppedStale.add(providerId);
    if (!firstDropIndex.has(providerId)) {
      firstDropIndex.set(providerId, index);
    }
  });

  const replacements = new Map<string, string[]>();
  for (const provider of customProviders) {
    if (
      droppedStale.has(provider.id)
      && !remaining.has(provider.id)
      && hadKeys.has(provider.id)
      && provider.models.length > 0
    ) {
      replacements.set(
        provider.id,
        provider.models.map((model) => `${provider.id}/${model.id}`),
      );
    }
  }

  const result: string[] = [];
  const inserted = new Set<string>();
  visibleModels.forEach((modelKey, index) => {
    const providerId = providerIdFromModelKey(modelKey);
    if (!providerId || !providersById.has(providerId)) {
      result.push(modelKey);
      return;
    }
    const modelId = modelKey.slice(providerId.length + 1);
    const allowed = allowedIdsByProvider.get(providerId);
    if (allowed?.has(modelId)) {
      result.push(modelKey);
      return;
    }
    const replacement = replacements.get(providerId);
    if (replacement && firstDropIndex.get(providerId) === index && !inserted.has(providerId)) {
      result.push(...replacement);
      inserted.add(providerId);
    }
  });

  for (const [providerId, keys] of replacements) {
    if (!inserted.has(providerId)) {
      result.push(...keys);
    }
  }

  return result;
}

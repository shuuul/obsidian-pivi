import { normalizeCustomProviders } from '@pivi/agent/settings/customProviders';

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function providerIdFromModelKey(modelKey: string): string | null {
  const slashIndex = modelKey.indexOf('/');
  if (slashIndex <= 0) {
    return null;
  }
  return modelKey.substring(0, slashIndex);
}

function hasCustomProviderContextLimits(
  raw: Record<string, unknown>,
  customProviderIds: ReadonlySet<string>,
): boolean {
  const limits = raw.customContextLimits;
  if (!isRecord(limits)) {
    return false;
  }
  return Object.keys(limits).some((modelKey) => {
    const providerId = providerIdFromModelKey(modelKey);
    return !!providerId && customProviderIds.has(providerId);
  });
}

export function hasSyncedProviderFields(raw: Record<string, unknown>): boolean {
  const agentSettings = raw.agentSettings;
  if (isRecord(agentSettings)) {
    if (Object.hasOwn(agentSettings, 'addedProviders')) {
      return true;
    }
    if (Object.hasOwn(agentSettings, 'disabledProviders')) {
      return true;
    }
    if (Object.hasOwn(agentSettings, 'customProviders')) {
      return true;
    }
    if (Object.hasOwn(agentSettings, 'visibleModels')) {
      return true;
    }
    if (Object.hasOwn(agentSettings, 'lastModel')) {
      return true;
    }
    if (Object.hasOwn(agentSettings, 'webSearchTools')) {
      return true;
    }
  }
  if (Object.hasOwn(raw, 'model')) {
    return true;
  }
  if (Object.hasOwn(raw, 'titleGenerationModel')) {
    return true;
  }

  const customProviders = isRecord(agentSettings) && Array.isArray(agentSettings.customProviders)
    ? normalizeCustomProviders(agentSettings.customProviders)
    : [];
  const customProviderIds = new Set(customProviders.map((provider) => provider.id));
  return hasCustomProviderContextLimits(raw, customProviderIds);
}

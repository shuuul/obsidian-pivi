import type { LegacyProviderMembershipSnapshot } from '@pivi/pivi-agent-core/engine/pi';
import {
  type CustomProviderConfig,
  normalizeCustomProviders,
} from '@pivi/pivi-agent-core/foundation/customProviders';
import {
  DEFAULT_WEB_SEARCH_TOOLS_SETTINGS,
  isWebProviderId,
  type WebSearchToolsSettings,
} from '@pivi/pivi-agent-core/foundation/settings';

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((entry): entry is string => typeof entry === 'string');
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

export function hasLegacyProviderFields(raw: Record<string, unknown>): boolean {
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

export function snapshotLegacyProviderMembership(
  raw: Record<string, unknown>,
): LegacyProviderMembershipSnapshot {
  const agentSettings = isRecord(raw.agentSettings) ? raw.agentSettings : {};
  const customProviders = Array.isArray(agentSettings.customProviders)
    ? normalizeCustomProviders(agentSettings.customProviders)
    : [];

  return {
    addedProviders: stringList(agentSettings.addedProviders),
    disabledProviders: stringList(agentSettings.disabledProviders),
    environmentVariables: typeof agentSettings.environmentVariables === 'string'
      ? agentSettings.environmentVariables
      : '',
    visibleModels: stringList(agentSettings.visibleModels),
    model: typeof raw.model === 'string' ? raw.model : '',
    titleGenerationModel: typeof raw.titleGenerationModel === 'string'
      ? raw.titleGenerationModel
      : '',
    ...(typeof agentSettings.lastModel === 'string'
      ? { lastModel: agentSettings.lastModel }
      : {}),
    customProviders,
  };
}

function readWebSearchToolsFromRaw(raw: Record<string, unknown>): WebSearchToolsSettings {
  const agentSettings = isRecord(raw.agentSettings) ? raw.agentSettings : {};
  const webRaw = isRecord(agentSettings.webSearchTools) ? agentSettings.webSearchTools : {};
  const providerOrder = Array.isArray(webRaw.providerOrder)
    ? webRaw.providerOrder
      .filter(isWebProviderId)
      .filter((providerId, index, ids) => ids.indexOf(providerId) === index)
    : [];
  const disabledProviders = Array.isArray(webRaw.disabledProviders)
    ? webRaw.disabledProviders
      .filter(isWebProviderId)
      .filter((providerId) => providerOrder.includes(providerId))
      .filter((providerId, index, ids) => ids.indexOf(providerId) === index)
    : [];
  return {
    providerOrder: providerOrder.length > 0
      ? providerOrder
      : [...DEFAULT_WEB_SEARCH_TOOLS_SETTINGS.providerOrder],
    disabledProviders,
  };
}

function readCustomContextLimitsForCustomProviders(
  raw: Record<string, unknown>,
  customProviders: readonly CustomProviderConfig[],
): Record<string, number> {
  const customProviderIds = new Set(customProviders.map((provider) => provider.id));
  const limits = isRecord(raw.customContextLimits) ? raw.customContextLimits : {};
  const result: Record<string, number> = {};
  for (const [modelKey, value] of Object.entries(limits)) {
    const providerId = providerIdFromModelKey(modelKey);
    if (!providerId || !customProviderIds.has(providerId)) {
      continue;
    }
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
      result[modelKey] = Math.floor(value);
    }
  }
  return result;
}

export function buildDeviceLocalStateInputFromLegacy(
  membership: LegacyProviderMembershipSnapshot,
  raw: Record<string, unknown>,
  customProvidersWithoutHeaders: readonly CustomProviderConfig[],
) {
  const providers = membership.addedProviders.map((id) => {
    const custom = customProvidersWithoutHeaders.find((provider) => provider.id === id);
    if (custom) {
      return {
        id,
        type: 'custom' as const,
        disabled: membership.disabledProviders.includes(id),
        config: custom,
      };
    }
    return {
      id,
      type: 'builtin' as const,
      disabled: membership.disabledProviders.includes(id),
    };
  });

  return {
    version: 1 as const,
    initialized: true as const,
    providers,
    modelPreferences: {
      visibleModels: [...membership.visibleModels],
      activeModel: membership.model,
      titleGenerationModel: membership.titleGenerationModel,
      ...(membership.lastModel ? { lastModel: membership.lastModel } : {}),
      customContextLimits: readCustomContextLimitsForCustomProviders(
        raw,
        customProvidersWithoutHeaders,
      ),
    },
    webSearchTools: readWebSearchToolsFromRaw(raw),
  };
}

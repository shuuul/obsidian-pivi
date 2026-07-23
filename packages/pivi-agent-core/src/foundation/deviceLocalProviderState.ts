import { isKnownPiProviderId } from '../auth/piProviderValidation';
import { getPiAgentSettings, updatePiAgentSettings } from './agentSettings';
import {
  type CustomProviderConfig,
  normalizeCustomProviderConfig,
} from './customProviders';
import type { PersistedPiviSettings } from './persistedPiviSettings';
import {
  DEFAULT_WEB_SEARCH_TOOLS_SETTINGS,
  getWebSearchToolsSettingsFromBag,
  type PiviSettings,
  resolveWebSearchToolsSettings,
  type WebProviderId,
  type WebSearchToolsSettings,
} from './settings';
import {
  DEFAULT_MODEL_KEY,
  DEFAULT_PI_PROVIDER_IDS,
} from './settingsDefaults';
import { isValidModelKey, type PiAgentSettingsView } from './settingsModelKey';

export const DEVICE_LOCAL_PROVIDER_STATE_VERSION = 1 as const;

export type DeviceLocalCustomProviderConfig = Omit<CustomProviderConfig, 'headers'>;

export type DeviceLocalProviderRegistration =
  | {
      id: string;
      type: 'builtin';
      disabled: boolean;
    }
  | {
      id: string;
      type: 'custom';
      disabled: boolean;
      config: DeviceLocalCustomProviderConfig;
    };

export interface DeviceLocalProviderStateV1 {
  version: 1;
  initialized: true;
  providers: DeviceLocalProviderRegistration[];
  modelPreferences: {
    visibleModels: string[];
    activeModel: string;
    titleGenerationModel: string;
    lastModel?: string;
    customContextLimits: Record<string, number>;
  };
  webSearchTools: {
    providerOrder: WebProviderId[];
    disabledProviders: WebProviderId[];
  };
}

export class DeviceLocalProviderStateVersionError extends Error {
  constructor(readonly unsupportedVersion: unknown) {
    super(`Unsupported device-local provider state version: ${String(unsupportedVersion)}`);
    this.name = 'DeviceLocalProviderStateVersionError';
  }
}

export interface DeviceLocalProviderStore {
  loadInitialized(): DeviceLocalProviderStateV1 | null;
  save(state: DeviceLocalProviderStateV1): void;
  isInitialized(): boolean;
}

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

function normalizeDeviceLocalCustomProviderConfig(
  raw: unknown,
): DeviceLocalCustomProviderConfig | null {
  const config = normalizeCustomProviderConfig(raw);
  if (!config) {
    return null;
  }
  const { headers: _headers, ...withoutHeaders } = config;
  return withoutHeaders;
}

function copyCustomProviderConfig(
  config: DeviceLocalCustomProviderConfig,
): DeviceLocalCustomProviderConfig {
  return {
    ...config,
    models: config.models.map((model) => ({ ...model })),
  };
}

function copyProviderRegistration(
  provider: DeviceLocalProviderRegistration,
): DeviceLocalProviderRegistration {
  if (provider.type === 'builtin') {
    return { ...provider };
  }
  return {
    ...provider,
    config: copyCustomProviderConfig(provider.config),
  };
}

function normalizeProviderRegistration(raw: unknown): DeviceLocalProviderRegistration | null {
  if (!isRecord(raw)) {
    return null;
  }

  const id = typeof raw.id === 'string' ? raw.id.trim() : '';
  if (!id) {
    return null;
  }

  const disabled = raw.disabled === true;
  const config = normalizeDeviceLocalCustomProviderConfig(raw.config);
  if (config) {
    if (config.id !== id) {
      return null;
    }
    return {
      id,
      type: 'custom',
      disabled,
      config,
    };
  }

  if (raw.type === 'custom') {
    return null;
  }

  return {
    id,
    type: 'builtin',
    disabled,
  };
}

function normalizeProviders(raw: unknown): DeviceLocalProviderRegistration[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  const seen = new Set<string>();
  const providers: DeviceLocalProviderRegistration[] = [];
  for (const entry of raw) {
    const provider = normalizeProviderRegistration(entry);
    if (!provider || seen.has(provider.id)) {
      continue;
    }
    seen.add(provider.id);
    providers.push(provider);
  }
  return providers;
}

function getCustomProviderIds(
  providers: readonly DeviceLocalProviderRegistration[],
): string[] {
  return providers
    .filter((provider): provider is Extract<DeviceLocalProviderRegistration, { type: 'custom' }> =>
      provider.type === 'custom')
    .map((provider) => provider.id);
}

function getEnabledProviderIds(
  providers: readonly DeviceLocalProviderRegistration[],
): Set<string> {
  return new Set(providers.filter((provider) => !provider.disabled).map((provider) => provider.id));
}

function isRegisteredProviderId(
  providerId: string,
  providers: readonly DeviceLocalProviderRegistration[],
): boolean {
  return providers.some((provider) => provider.id === providerId);
}

function isModelAllowed(
  modelKey: string,
  enabledProviderIds: ReadonlySet<string>,
  customProviderIds: readonly string[],
): boolean {
  const providerId = providerIdFromModelKey(modelKey);
  if (!providerId || !enabledProviderIds.has(providerId)) {
    return false;
  }
  return isValidModelKey(modelKey)
    && isKnownPiProviderId(providerId, customProviderIds);
}

function normalizeVisibleModels(
  rawVisibleModels: unknown,
  activeModel: string,
  enabledProviderIds: ReadonlySet<string>,
  customProviderIds: readonly string[],
): string[] {
  const source = Array.isArray(rawVisibleModels)
    ? rawVisibleModels.filter((model): model is string => typeof model === 'string')
    : [];
  const ordered: string[] = [];
  const seen = new Set<string>();
  const pushModel = (modelKey: string): void => {
    const trimmed = modelKey.trim();
    if (!trimmed || seen.has(trimmed)) {
      return;
    }
    if (!isModelAllowed(trimmed, enabledProviderIds, customProviderIds)) {
      return;
    }
    seen.add(trimmed);
    ordered.push(trimmed);
  };

  if (activeModel.trim()) {
    pushModel(activeModel);
  }
  for (const modelKey of source) {
    pushModel(modelKey);
  }
  return ordered;
}

function normalizeOptionalModelReference(
  raw: unknown,
  enabledProviderIds: ReadonlySet<string>,
  customProviderIds: readonly string[],
): string | undefined {
  if (typeof raw !== 'string') {
    return undefined;
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    return undefined;
  }
  return isModelAllowed(trimmed, enabledProviderIds, customProviderIds)
    ? trimmed
    : undefined;
}

function normalizeCustomContextLimits(
  raw: unknown,
  providers: readonly DeviceLocalProviderRegistration[],
): Record<string, number> {
  if (!isRecord(raw)) {
    return {};
  }

  const customProviderIds = new Set(getCustomProviderIds(providers));
  const limits: Record<string, number> = {};
  for (const [modelKey, value] of Object.entries(raw)) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
      continue;
    }
    const providerId = providerIdFromModelKey(modelKey);
    if (!providerId || !customProviderIds.has(providerId)) {
      continue;
    }
    if (!isRegisteredProviderId(providerId, providers)) {
      continue;
    }
    limits[modelKey] = Math.floor(value);
  }
  return limits;
}

function normalizeWebSearchTools(raw: unknown): WebSearchToolsSettings {
  return resolveWebSearchToolsSettings(isRecord(raw) ? raw : undefined);

}

function normalizeModelPreferences(
  raw: unknown,
  providers: readonly DeviceLocalProviderRegistration[],
): DeviceLocalProviderStateV1['modelPreferences'] {
  const record = isRecord(raw) ? raw : {};
  const enabledProviderIds = getEnabledProviderIds(providers);
  const customProviderIds = getCustomProviderIds(providers);

  const requestedActiveModel = typeof record.activeModel === 'string'
    ? record.activeModel.trim()
    : '';
  const visibleModels = normalizeVisibleModels(
    record.visibleModels,
    requestedActiveModel,
    enabledProviderIds,
    customProviderIds,
  );

  const firstVisibleModel = visibleModels[0];
  let activeModel = '';
  if (requestedActiveModel && visibleModels[0] === requestedActiveModel) {
    activeModel = requestedActiveModel;
  } else if (firstVisibleModel !== undefined) {
    activeModel = firstVisibleModel;
  }

  const titleCandidate = typeof record.titleGenerationModel === 'string'
    ? record.titleGenerationModel.trim()
    : '';
  const titleGenerationModel = titleCandidate
    && isModelAllowed(titleCandidate, enabledProviderIds, customProviderIds)
    ? titleCandidate
    : '';

  const lastModel = normalizeOptionalModelReference(
    record.lastModel,
    enabledProviderIds,
    customProviderIds,
  );

  return {
    visibleModels: activeModel
      ? [activeModel, ...visibleModels.filter((model) => model !== activeModel)]
      : visibleModels,
    activeModel,
    titleGenerationModel,
    ...(lastModel ? { lastModel } : {}),
    customContextLimits: normalizeCustomContextLimits(record.customContextLimits, providers),
  };
}

/** Enforce device-local provider invariants and return defensive copies. */
export function normalizeDeviceLocalProviderState(
  raw: unknown,
): DeviceLocalProviderStateV1 {
  const record = isRecord(raw) ? raw : {};
  const providers = normalizeProviders(record.providers).map(copyProviderRegistration);
  const modelPreferences = normalizeModelPreferences(record.modelPreferences, providers);
  const webSearchTools = normalizeWebSearchTools(record.webSearchTools);

  return {
    version: DEVICE_LOCAL_PROVIDER_STATE_VERSION,
    initialized: true,
    providers,
    modelPreferences: {
      ...modelPreferences,
      visibleModels: [...modelPreferences.visibleModels],
      customContextLimits: { ...modelPreferences.customContextLimits },
    },
    webSearchTools: {
      providerOrder: [...webSearchTools.providerOrder],
      disabledProviders: [...webSearchTools.disabledProviders],
    },
  };
}

export function seedDefaultDeviceLocalProviderState(): DeviceLocalProviderStateV1 {
  return normalizeDeviceLocalProviderState({
    version: DEVICE_LOCAL_PROVIDER_STATE_VERSION,
    initialized: true,
    providers: DEFAULT_PI_PROVIDER_IDS.map((id) => ({
      id,
      type: 'builtin',
      disabled: false,
    })),
    modelPreferences: {
      visibleModels: [DEFAULT_MODEL_KEY],
      activeModel: DEFAULT_MODEL_KEY,
      titleGenerationModel: '',
      customContextLimits: {},
    },
    webSearchTools: {
      providerOrder: [...DEFAULT_WEB_SEARCH_TOOLS_SETTINGS.providerOrder],
      disabledProviders: [],
    },
  });
}

export function projectProviderState(
  state: DeviceLocalProviderStateV1,
): Pick<
  PiAgentSettingsView,
  'addedProviders' | 'disabledProviders' | 'customProviders' | 'visibleModels'
> {
  const normalized = normalizeDeviceLocalProviderState(state);
  const addedProviders = normalized.providers.map((provider) => provider.id);
  const disabledProviders = normalized.providers
    .filter((provider) => provider.disabled)
    .map((provider) => provider.id);
  const customProviders = normalized.providers
    .filter((provider): provider is Extract<DeviceLocalProviderRegistration, { type: 'custom' }> =>
      provider.type === 'custom')
    .map((provider) => copyCustomProviderConfig(provider.config));
  return {
    addedProviders: [...addedProviders],
    disabledProviders: [...disabledProviders],
    customProviders,
    visibleModels: [...normalized.modelPreferences.visibleModels],
  };
}

export function extractDeviceLocalProviderState(
  settings: PiviSettings,
): DeviceLocalProviderStateV1 {
  const view = getPiAgentSettings(settings);
  const providers: DeviceLocalProviderRegistration[] = view.addedProviders.map((id) => {
    const custom = view.customProviders.find((provider) => provider.id === id);
    if (custom) {
      const { headers: _headers, ...config } = custom;
      return {
        id,
        type: 'custom' as const,
        disabled: view.disabledProviders.includes(id),
        config,
      };
    }
    return {
      id,
      type: 'builtin' as const,
      disabled: view.disabledProviders.includes(id),
    };
  });

  const webSearchTools = getWebSearchToolsSettingsFromBag(settings);
  const customProviderIds = new Set(view.customProviders.map((provider) => provider.id));
  const customContextLimits: Record<string, number> = {};
  for (const [modelKey, value] of Object.entries(settings.customContextLimits)) {
    const providerId = providerIdFromModelKey(modelKey);
    if (!providerId || !customProviderIds.has(providerId)) {
      continue;
    }
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
      customContextLimits[modelKey] = Math.floor(value);
    }
  }

  const activeModel = typeof settings.model === 'string' ? settings.model.trim() : '';
  const titleGenerationModel = typeof settings.titleGenerationModel === 'string'
    ? settings.titleGenerationModel
    : '';
  const lastModel = settings.agentSettings.lastModel;

  return normalizeDeviceLocalProviderState({
    version: DEVICE_LOCAL_PROVIDER_STATE_VERSION,
    initialized: true,
    providers,
    modelPreferences: {
      visibleModels: view.visibleModels,
      activeModel,
      titleGenerationModel,
      ...(typeof lastModel === 'string' ? { lastModel } : {}),
      customContextLimits,
    },
    webSearchTools,
  });
}

export function stripLocalizedFieldsFromRuntimeSettings(
  settings: PiviSettings,
): PersistedPiviSettings {
  const view = getPiAgentSettings(settings);
  const customProviderIds = new Set(view.customProviders.map((provider) => provider.id));
  const syncedContextLimits: Record<string, number> = {};

  for (const [modelKey, value] of Object.entries(settings.customContextLimits)) {
    const providerId = providerIdFromModelKey(modelKey);
    if (!providerId || customProviderIds.has(providerId)) {
      continue;
    }
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
      syncedContextLimits[modelKey] = Math.floor(value);
    }
  }

  const {
    addedProviders: _addedProviders,
    disabledProviders: _disabledProviders,
    customProviders: _customProviders,
    visibleModels: _visibleModels,
    lastModel: _lastModel,
    webSearchTools: _webSearchTools,
    environmentVariables: _environmentVariables,
    ...syncedAgentSettings
  } = settings.agentSettings;

  const {
    model: _model,
    titleGenerationModel: _titleGenerationModel,
    customContextLimits: _customContextLimits,
    agentSettings: _agentSettings,
    sharedEnvironmentVariables: _sharedEnvironmentVariables,
    ...portableSettings
  } = settings;

  return {
    ...portableSettings,
    customContextLimits: syncedContextLimits,
    agentSettings: syncedAgentSettings,
  };
}

export function assertSupportedDeviceLocalProviderStateVersion(
  version: unknown,
): asserts version is typeof DEVICE_LOCAL_PROVIDER_STATE_VERSION {
  if (version !== DEVICE_LOCAL_PROVIDER_STATE_VERSION) {
    throw new DeviceLocalProviderStateVersionError(version);
  }
}

function providerIdFromModelKeyForOverlay(modelKey: string): string | null {
  const slashIndex = modelKey.indexOf('/');
  if (slashIndex <= 0) {
    return null;
  }
  return modelKey.substring(0, slashIndex);
}

/** Overlay initialized local provider state into runtime settings. */
export function overlayDeviceLocalProviderState(
  settings: PiviSettings,
  state: DeviceLocalProviderStateV1,
): void {
  const normalized = normalizeDeviceLocalProviderState(state);
  const projected = projectProviderState(normalized);
  updatePiAgentSettings(settings, {
    ...projected,
    ...(normalized.modelPreferences.lastModel
      ? { lastModel: normalized.modelPreferences.lastModel }
      : {}),
  });
  settings.agentSettings.webSearchTools = normalized.webSearchTools;
  settings.model = normalized.modelPreferences.activeModel;
  settings.titleGenerationModel = normalized.modelPreferences.titleGenerationModel;

  const customProviderIds = new Set(projected.customProviders.map((provider) => provider.id));
  const syncedContextLimits: Record<string, number> = {};
  for (const [modelKey, value] of Object.entries(settings.customContextLimits)) {
    const providerId = providerIdFromModelKeyForOverlay(modelKey);
    if (providerId && customProviderIds.has(providerId)) {
      continue;
    }
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
      syncedContextLimits[modelKey] = Math.floor(value);
    }
  }
  settings.customContextLimits = {
    ...syncedContextLimits,
    ...normalized.modelPreferences.customContextLimits,
  };
}

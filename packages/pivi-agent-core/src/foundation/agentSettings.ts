import {
  isBuiltinPiProviderId,
  isKnownPiProviderId,
  isSupportedPiModelKey,
} from '../auth/piProviderValidation';
import {
  type CustomProviderConfig,
  normalizeCustomProviders,
} from './customProviders';
import type { AgentRuntimeSettings } from './settings';
import { getAgentEnvironmentVariables } from './settingsAgentEnvironment';
import {
  DEFAULT_AGENT_SETTINGS as DEFAULT_PI_AGENT_SETTINGS,
  DEFAULT_MODEL_KEY,
  PI_DEFAULT_ENVIRONMENT_VARIABLES,
} from './settingsDefaults';
import {
  isValidModelKey,
  type PiAgentSettingsView,
} from './settingsModelKey';

function sanitizeVisibleModels(
  raw: string[],
  customProviderIds: readonly string[],
): string[] {
  const valid = raw.filter(
    (modelKey) => isValidModelKey(modelKey) && isSupportedPiModelKey(modelKey, customProviderIds),
  );
  return valid.length > 0
    ? valid
    : [...DEFAULT_PI_AGENT_SETTINGS.visibleModels];
}

function ensurePiSettingsRecord(
  settings: Record<string, unknown>,
): AgentRuntimeSettings {
  const current = settings.agentSettings;
  if (current && typeof current === 'object' && !Array.isArray(current)) {
    return current as AgentRuntimeSettings;
  }

  const next: AgentRuntimeSettings = {
    ...DEFAULT_PI_AGENT_SETTINGS,
    environmentVariables: PI_DEFAULT_ENVIRONMENT_VARIABLES,
  };
  settings.agentSettings = next;
  return next;
}

function readCustomProviders(config: AgentRuntimeSettings): CustomProviderConfig[] {
  return normalizeCustomProviders(config.customProviders);
}

export function getPiAgentSettings(
  settings: Record<string, unknown>,
): PiAgentSettingsView {
  const config = ensurePiSettingsRecord(settings);
  const customProviders = readCustomProviders(config);
  const customProviderIds = customProviders.map((provider) => provider.id);

  const rawAdded = Array.isArray(config.addedProviders)
    ? config.addedProviders
    : [...DEFAULT_PI_AGENT_SETTINGS.addedProviders];
  const addedProviders = rawAdded.filter((id) => isKnownPiProviderId(id, customProviderIds));

  const disabledProviders = Array.isArray(config.disabledProviders)
    ? config.disabledProviders.filter((id) => isKnownPiProviderId(id, customProviderIds))
    : [];

  const rawVisibleModels = Array.isArray(config.visibleModels)
    ? config.visibleModels
    : [...DEFAULT_PI_AGENT_SETTINGS.visibleModels];

  return {
    addedProviders,
    disabledProviders,
    customProviders,
    availableModes: ['default'],
    discoveredModels: [DEFAULT_MODEL_KEY],
    environmentVariables:
      config.environmentVariables ??
      getAgentEnvironmentVariables(settings) ??
      DEFAULT_PI_AGENT_SETTINGS.environmentVariables,
    selectedMode: config.selectedMode ?? DEFAULT_PI_AGENT_SETTINGS.selectedMode,
    visibleModels: sanitizeVisibleModels(rawVisibleModels, customProviderIds),
  };
}

export function updatePiAgentSettings(
  settings: Record<string, unknown>,
  updates: Partial<PiAgentSettingsView> &
    Pick<Partial<AgentRuntimeSettings>, 'lastModel' | 'environmentHash'>,
): PiAgentSettingsView {
  const current = getPiAgentSettings(settings);
  const config = ensurePiSettingsRecord(settings);

  const next: PiAgentSettingsView = {
    ...current,
    ...updates,
  };

  // Keep customProviders aligned with addedProviders when either is patched.
  if (updates.customProviders !== undefined) {
    next.customProviders = normalizeCustomProviders(updates.customProviders);
  }
  if (updates.addedProviders !== undefined) {
    const customIds = new Set(next.customProviders.map((provider) => provider.id));
    next.addedProviders = updates.addedProviders.filter(
      (id) => isBuiltinPiProviderId(id) || customIds.has(id),
    );
    next.customProviders = next.customProviders.filter((provider) =>
      next.addedProviders.includes(provider.id),
    );
  }

  config.addedProviders = next.addedProviders;
  config.disabledProviders = next.disabledProviders;
  config.environmentVariables = next.environmentVariables;
  config.selectedMode = next.selectedMode;
  config.visibleModels = next.visibleModels;
  config.customProviders = next.customProviders;

  if (updates.lastModel !== undefined) {
    config.lastModel = updates.lastModel;
  }
  if (updates.environmentHash !== undefined) {
    config.environmentHash = updates.environmentHash;
  }

  return getPiAgentSettings(settings);
}

export function normalizePiAgentSettingsRecord(
  settings: Record<string, unknown>,
  source: Record<string, unknown> = settings,
): boolean {
  const before = JSON.stringify(settings.agentSettings ?? null);
  const view = getPiAgentSettings(source);
  const config = ensurePiSettingsRecord(settings);

  // Write a stable normalized shape without forcing optional fields onto
  // already-clean records (avoids false-positive change reports).
  config.addedProviders = view.addedProviders;
  config.disabledProviders = view.disabledProviders;
  config.environmentVariables = view.environmentVariables;
  config.selectedMode = view.selectedMode;
  config.visibleModels = view.visibleModels;
  if (view.customProviders.length > 0 || Array.isArray(config.customProviders)) {
    config.customProviders = view.customProviders;
  } else {
    delete config.customProviders;
  }

  const customIds = view.customProviders.map((provider) => provider.id);
  if (
    typeof settings.model === 'string' &&
    isValidModelKey(settings.model) &&
    !isSupportedPiModelKey(settings.model, customIds)
  ) {
    settings.model = '';
  }

  return before !== JSON.stringify(settings.agentSettings ?? null);
}

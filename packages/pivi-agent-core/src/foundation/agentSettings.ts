import { isSupportedPiModelKey, isSupportedPiProviderId } from '../auth/piProviderValidation';
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

function sanitizeVisibleModels(raw: string[]): string[] {
  const valid = raw.filter(
    (modelKey) => isValidModelKey(modelKey) && isSupportedPiModelKey(modelKey),
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

export function getPiAgentSettings(
  settings: Record<string, unknown>,
): PiAgentSettingsView {
  const config = ensurePiSettingsRecord(settings);
  const addedProviders = Array.isArray(config.addedProviders)
    ? config.addedProviders.filter(isSupportedPiProviderId)
    : [...DEFAULT_PI_AGENT_SETTINGS.addedProviders];

  const disabledProviders = Array.isArray(config.disabledProviders)
    ? config.disabledProviders.filter(isSupportedPiProviderId)
    : [];

  const rawVisibleModels = Array.isArray(config.visibleModels)
    ? config.visibleModels
    : [...DEFAULT_PI_AGENT_SETTINGS.visibleModels];

  return {
    addedProviders,
    disabledProviders,
    availableModes: ['default'],
    discoveredModels: [DEFAULT_MODEL_KEY],
    environmentVariables:
      config.environmentVariables ??
      getAgentEnvironmentVariables(settings) ??
      DEFAULT_PI_AGENT_SETTINGS.environmentVariables,
    selectedMode: config.selectedMode ?? DEFAULT_PI_AGENT_SETTINGS.selectedMode,
    visibleModels: sanitizeVisibleModels(rawVisibleModels),
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

  config.addedProviders = next.addedProviders;
  config.disabledProviders = next.disabledProviders;
  config.environmentVariables = next.environmentVariables;
  config.selectedMode = next.selectedMode;
  config.visibleModels = next.visibleModels;

  if (updates.lastModel !== undefined) {
    config.lastModel = updates.lastModel;
  }
  if (updates.environmentHash !== undefined) {
    config.environmentHash = updates.environmentHash;
  }

  return next;
}

export function normalizePiAgentSettingsRecord(
  settings: Record<string, unknown>,
  source: Record<string, unknown> = settings,
): boolean {
  const before = JSON.stringify(settings.agentSettings ?? null);
  updatePiAgentSettings(settings, getPiAgentSettings(source));

  if (
    typeof settings.model === 'string' &&
    isValidModelKey(settings.model) &&
    !isSupportedPiModelKey(settings.model)
  ) {
    settings.model = '';
  }

  return before !== JSON.stringify(settings.agentSettings ?? null);
}

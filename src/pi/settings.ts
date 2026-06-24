import { getPiEnvironmentVariables } from '../core/agent/agentEnvironment';
import {
  DEFAULT_MODEL_KEY,
  DEFAULT_PI_AGENT_SETTINGS,
  PI_DEFAULT_ENVIRONMENT_VARIABLES,
} from '../core/settings/agentDefaults';
import type { PiAgentSettings } from '../core/types/settings';
import { isSupportedPiModelKey, isSupportedPiProviderId } from './piAiModels';

/** Persisted pi-ai model/API configuration on the settings bag. */
export interface PersistedPiAgentSettings {
  addedProviders?: string[];
  disabledProviders?: string[];
  environmentVariables: string;
  selectedMode: string;
  visibleModels: string[];
}

/** Runtime view of Pi agent settings (includes derived fields for the settings UI). */
export interface PiAgentSettingsView extends PersistedPiAgentSettings {
  addedProviders: string[];
  disabledProviders: string[];
  availableModes: string[];
  discoveredModels: string[];
}

export function isValidModelKey(key: string): boolean {
  const slashIndex = key.indexOf('/');
  return slashIndex > 0 && slashIndex < key.length - 1;
}

function sanitizeVisibleModels(raw: string[]): string[] {
  const valid = raw.filter((modelKey) => isValidModelKey(modelKey) && isSupportedPiModelKey(modelKey));
  return valid.length > 0 ? valid : [...DEFAULT_PI_AGENT_SETTINGS.visibleModels];
}

function ensurePiSettingsRecord(settings: Record<string, unknown>): PiAgentSettings {
  const current = settings.agentSettings;
  if (current && typeof current === 'object' && !Array.isArray(current)) {
    return current as PiAgentSettings;
  }

  const next: PiAgentSettings = {
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
    : [...DEFAULT_PI_AGENT_SETTINGS.addedProviders!];

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
    environmentVariables: config.environmentVariables
      ?? getPiEnvironmentVariables(settings)
      ?? DEFAULT_PI_AGENT_SETTINGS.environmentVariables,
    selectedMode: config.selectedMode ?? DEFAULT_PI_AGENT_SETTINGS.selectedMode,
    visibleModels: sanitizeVisibleModels(rawVisibleModels),
  };
}

export function updatePiAgentSettings(
  settings: Record<string, unknown>,
  updates: Partial<PiAgentSettingsView> & Pick<Partial<PiAgentSettings>, 'lastModel' | 'environmentHash'>,
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
    typeof settings.model === 'string'
    && isValidModelKey(settings.model)
    && !isSupportedPiModelKey(settings.model)
  ) {
    settings.model = '';
  }

  return before !== JSON.stringify(settings.agentSettings ?? null);
}

import { getProviderEnvironmentVariables } from '../core/agent/providerEnvironment';
import type { PiAgentSettings } from '../core/types/settings';

export interface PersistedPiProviderSettings {
  addedProviders?: string[];
  environmentVariables: string;
  selectedMode: string;
  visibleModels: string[];
}

export interface PiProviderSettings extends PersistedPiProviderSettings {
  addedProviders: string[];
  availableModes: string[];
  discoveredModels: string[];
}

export const PI_DEFAULT_ENVIRONMENT_VARIABLES = 'PI_ENABLE_EXA=1';

export const DEFAULT_PI_PROVIDER_SETTINGS: Readonly<PersistedPiProviderSettings> = Object.freeze({
  addedProviders: ['anthropic', 'openai', 'google', 'deepseek', 'openrouter'],
  environmentVariables: PI_DEFAULT_ENVIRONMENT_VARIABLES,
  selectedMode: 'default',
  visibleModels: ['anthropic/claude-sonnet-4-20250514'],
});

export function isValidModelKey(key: string): boolean {
  const slashIndex = key.indexOf('/');
  return slashIndex > 0 && slashIndex < key.length - 1;
}

function sanitizeVisibleModels(raw: string[]): string[] {
  const valid = raw.filter(isValidModelKey);
  return valid.length > 0 ? valid : [...DEFAULT_PI_PROVIDER_SETTINGS.visibleModels];
}

function ensurePiSettingsRecord(settings: Record<string, unknown>): PiAgentSettings {
  const current = settings.piSettings;
  if (current && typeof current === 'object' && !Array.isArray(current)) {
    return current as PiAgentSettings;
  }

  const next: PiAgentSettings = {
    ...DEFAULT_PI_PROVIDER_SETTINGS,
    environmentVariables: PI_DEFAULT_ENVIRONMENT_VARIABLES,
  };
  settings.piSettings = next;
  return next;
}

export function getPiProviderSettings(
  settings: Record<string, unknown>,
): PiProviderSettings {
  const config = ensurePiSettingsRecord(settings);
  const addedProviders = Array.isArray(config.addedProviders)
    ? config.addedProviders
    : [...DEFAULT_PI_PROVIDER_SETTINGS.addedProviders!];

  const rawVisibleModels = Array.isArray(config.visibleModels)
    ? config.visibleModels
    : [...DEFAULT_PI_PROVIDER_SETTINGS.visibleModels];

  return {
    addedProviders,
    availableModes: ['default'],
    discoveredModels: ['anthropic/claude-sonnet-4-20250514'],
    environmentVariables: config.environmentVariables
      ?? getProviderEnvironmentVariables(settings)
      ?? DEFAULT_PI_PROVIDER_SETTINGS.environmentVariables,
    selectedMode: config.selectedMode ?? DEFAULT_PI_PROVIDER_SETTINGS.selectedMode,
    visibleModels: sanitizeVisibleModels(rawVisibleModels),
  };
}

export function updatePiProviderSettings(
  settings: Record<string, unknown>,
  updates: Partial<PiProviderSettings> & Pick<Partial<PiAgentSettings>, 'lastModel' | 'environmentHash'>,
): PiProviderSettings {
  const current = getPiProviderSettings(settings);
  const config = ensurePiSettingsRecord(settings);

  const next: PiProviderSettings = {
    ...current,
    ...updates,
  };

  config.addedProviders = next.addedProviders;
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

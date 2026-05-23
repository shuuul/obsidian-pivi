import { getProviderConfig, setProviderConfig } from '../../core/providers/providerConfig';
import { getProviderEnvironmentVariables } from '../../core/providers/providerEnvironment';

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

export function getPiProviderSettings(
  settings: Record<string, unknown>,
): PiProviderSettings {
  const config = getProviderConfig(settings, 'pi');
  const addedProviders = Array.isArray(config.addedProviders)
    ? config.addedProviders as string[]
    : [...DEFAULT_PI_PROVIDER_SETTINGS.addedProviders!];

  const rawVisibleModels = Array.isArray(config.visibleModels)
    ? config.visibleModels as string[]
    : [...DEFAULT_PI_PROVIDER_SETTINGS.visibleModels];

  return {
    addedProviders,
    availableModes: ['default'],
    discoveredModels: ['anthropic/claude-sonnet-4-20250514'],
    environmentVariables: (config.environmentVariables as string | undefined)
      ?? getProviderEnvironmentVariables(settings, 'pi')
      ?? DEFAULT_PI_PROVIDER_SETTINGS.environmentVariables,
    selectedMode: (config.selectedMode as string | undefined) ?? DEFAULT_PI_PROVIDER_SETTINGS.selectedMode,
    visibleModels: sanitizeVisibleModels(rawVisibleModels),
  };
}

export function updatePiProviderSettings(
  settings: Record<string, unknown>,
  updates: Partial<PiProviderSettings>,
): PiProviderSettings {
  const current = getPiProviderSettings(settings);

  const next: PiProviderSettings = {
    ...current,
    ...updates,
  };

  setProviderConfig(settings, 'pi', {
    addedProviders: next.addedProviders,
    environmentVariables: next.environmentVariables,
    selectedMode: next.selectedMode,
    visibleModels: next.visibleModels,
  });

  return next;
}

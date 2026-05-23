import { getProviderConfig, setProviderConfig } from '../../core/providers/providerConfig';
import { getProviderEnvironmentVariables } from '../../core/providers/providerEnvironment';

export interface PersistedPiProviderSettings {
  addedProviders?: string[];
  enabled: boolean;
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
  enabled: true,
  environmentVariables: PI_DEFAULT_ENVIRONMENT_VARIABLES,
  selectedMode: 'default',
  visibleModels: ['pi-default'],
});

export function getPiProviderSettings(
  settings: Record<string, unknown>,
): PiProviderSettings {
  const config = getProviderConfig(settings, 'pi');
  const addedProviders = Array.isArray(config.addedProviders)
    ? config.addedProviders as string[]
    : [...DEFAULT_PI_PROVIDER_SETTINGS.addedProviders!];

  return {
    addedProviders,
    availableModes: ['default'],
    discoveredModels: ['pi-default'],
    enabled: (config.enabled as boolean | undefined)
      ?? DEFAULT_PI_PROVIDER_SETTINGS.enabled,
    environmentVariables: (config.environmentVariables as string | undefined)
      ?? getProviderEnvironmentVariables(settings, 'pi')
      ?? DEFAULT_PI_PROVIDER_SETTINGS.environmentVariables,
    selectedMode: (config.selectedMode as string | undefined) ?? DEFAULT_PI_PROVIDER_SETTINGS.selectedMode,
    visibleModels: Array.isArray(config.visibleModels) ? config.visibleModels : [...DEFAULT_PI_PROVIDER_SETTINGS.visibleModels],
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
    enabled: next.enabled,
    environmentVariables: next.environmentVariables,
    selectedMode: next.selectedMode,
    visibleModels: next.visibleModels,
  });

  return next;
}

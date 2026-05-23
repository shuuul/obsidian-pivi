import { getProviderConfig, setProviderConfig } from '../../core/providers/providerConfig';
import { getProviderEnvironmentVariables } from '../../core/providers/providerEnvironment';
import type { HostnameCliPaths } from '../../core/types/settings';
import { getHostnameKey, getLegacyHostnameKey, migrateLegacyHostnameKeyedMap } from '../../utils/env';

export interface PersistedPiProviderSettings {
  cliPath: string;
  cliPathsByHost: HostnameCliPaths;
  enabled: boolean;
  environmentVariables: string;
  selectedMode: string;
  visibleModels: string[];
}

export interface PiProviderSettings extends PersistedPiProviderSettings {
  availableModes: string[];
  discoveredModels: string[];
}

export const PI_DEFAULT_ENVIRONMENT_VARIABLES = 'PI_ENABLE_EXA=1';

export const DEFAULT_PI_PROVIDER_SETTINGS: Readonly<PersistedPiProviderSettings> = Object.freeze({
  cliPath: '',
  cliPathsByHost: {},
  enabled: true,
  environmentVariables: PI_DEFAULT_ENVIRONMENT_VARIABLES,
  selectedMode: 'default',
  visibleModels: ['pi-default'],
});

function normalizeHostnameCliPaths(value: unknown): HostnameCliPaths {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  const result: HostnameCliPaths = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === 'string' && entry.trim()) {
      result[key] = entry.trim();
    }
  }
  return result;
}

export function getPiProviderSettings(
  settings: Record<string, unknown>,
): PiProviderSettings {
  const config = getProviderConfig(settings, 'pi');
  const normalizedCliPathsByHost = normalizeHostnameCliPaths(config.cliPathsByHost);
  const cliPathsByHost = Object.keys(normalizedCliPathsByHost).length > 0
    ? migrateLegacyHostnameKeyedMap(
      normalizedCliPathsByHost,
      getHostnameKey(),
      getLegacyHostnameKey(),
    )
    : normalizedCliPathsByHost;

  return {
    availableModes: ['default'],
    cliPath: (config.cliPath as string | undefined)
      ?? DEFAULT_PI_PROVIDER_SETTINGS.cliPath,
    cliPathsByHost,
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
  const hostnameKey = getHostnameKey();
  const nextCliPathsByHost = 'cliPathsByHost' in updates
    ? normalizeHostnameCliPaths(updates.cliPathsByHost)
    : { ...current.cliPathsByHost };
  let nextCliPath = 'cliPathsByHost' in updates
    ? (
      typeof updates.cliPath === 'string'
        ? updates.cliPath.trim()
        : DEFAULT_PI_PROVIDER_SETTINGS.cliPath
    )
    : current.cliPath.trim();

  if ('cliPath' in updates && !('cliPathsByHost' in updates)) {
    const trimmedCliPath = typeof updates.cliPath === 'string' ? updates.cliPath.trim() : '';
    if (trimmedCliPath) {
      nextCliPathsByHost[hostnameKey] = trimmedCliPath;
    } else {
      delete nextCliPathsByHost[hostnameKey];
    }
    nextCliPath = DEFAULT_PI_PROVIDER_SETTINGS.cliPath;
  }

  const next: PiProviderSettings = {
    ...current,
    ...updates,
    cliPath: nextCliPath,
    cliPathsByHost: nextCliPathsByHost,
  };

  setProviderConfig(settings, 'pi', {
    cliPath: next.cliPath,
    cliPathsByHost: next.cliPathsByHost,
    enabled: next.enabled,
    environmentVariables: next.environmentVariables,
    selectedMode: next.selectedMode,
    visibleModels: next.visibleModels,
  });

  return next;
}

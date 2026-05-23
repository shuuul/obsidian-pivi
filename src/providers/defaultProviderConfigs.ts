import type { ProviderConfigMap } from '../core/types/settings';
import { DEFAULT_PI_PROVIDER_SETTINGS } from './pi/settings';

export function getBuiltInProviderDefaultConfigs(): ProviderConfigMap {
  return {
    pi: { ...DEFAULT_PI_PROVIDER_SETTINGS },
  };
}

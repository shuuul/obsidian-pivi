import type { ObsiusSettings } from '../types/settings';
import { DEFAULT_MODEL_KEY } from './agentDefaults';

/**
 * Keep `ObsiusSettings.model` and `piSettings.visibleModels[0]` aligned.
 * Returns true when settings were mutated.
 */
export function reconcileActiveModelFields(settings: ObsiusSettings): boolean {
  let changed = false;
  const piSettings = settings.piSettings;
  const trimmedModel = typeof settings.model === 'string' ? settings.model.trim() : '';
  const primaryVisible = piSettings.visibleModels[0]?.trim() ?? '';

  if (trimmedModel) {
    if (settings.model !== trimmedModel) {
      settings.model = trimmedModel;
      changed = true;
    }
    if (piSettings.visibleModels[0] !== trimmedModel) {
      piSettings.visibleModels = [
        trimmedModel,
        ...piSettings.visibleModels.filter(model => model !== trimmedModel),
      ];
      changed = true;
    }
    return changed;
  }

  if (primaryVisible) {
    settings.model = primaryVisible;
    return true;
  }

  settings.model = DEFAULT_MODEL_KEY;
  piSettings.visibleModels = [
    DEFAULT_MODEL_KEY,
    ...piSettings.visibleModels.filter(model => model !== DEFAULT_MODEL_KEY),
  ];
  return true;
}

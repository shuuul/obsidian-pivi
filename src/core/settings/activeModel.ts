import type { ObsiusSettings } from '../types/settings';
import { DEFAULT_MODEL_KEY } from './agentDefaults';

/**
 * Keep `ObsiusSettings.model` and `agentSettings.visibleModels[0]` aligned.
 * Returns true when settings were mutated.
 */
export function reconcileActiveModelFields(settings: ObsiusSettings): boolean {
  let changed = false;
  const agentSettings = settings.agentSettings;
  const trimmedModel = typeof settings.model === 'string' ? settings.model.trim() : '';
  const primaryVisible = agentSettings.visibleModels[0]?.trim() ?? '';

  if (trimmedModel) {
    if (settings.model !== trimmedModel) {
      settings.model = trimmedModel;
      changed = true;
    }
    if (agentSettings.visibleModels[0] !== trimmedModel) {
      agentSettings.visibleModels = [
        trimmedModel,
        ...agentSettings.visibleModels.filter(model => model !== trimmedModel),
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
  agentSettings.visibleModels = [
    DEFAULT_MODEL_KEY,
    ...agentSettings.visibleModels.filter(model => model !== DEFAULT_MODEL_KEY),
  ];
  return true;
}

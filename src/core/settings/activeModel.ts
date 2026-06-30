import { DEFAULT_MODEL_KEY } from "./agentDefaults";

interface ActiveModelSettingsBag extends Record<string, unknown> {
  model?: unknown;
  agentSettings?: {
    visibleModels?: unknown;
  };
}

function readVisibleModels(settings: ActiveModelSettingsBag): string[] {
  const visibleModels = settings.agentSettings?.visibleModels;
  return Array.isArray(visibleModels)
    ? visibleModels.filter(
        (model): model is string => typeof model === "string",
      )
    : [];
}

function ensureAgentSettings(settings: ActiveModelSettingsBag): {
  visibleModels: string[];
} {
  const visibleModels = readVisibleModels(settings);
  const agentSettings = {
    ...settings.agentSettings,
    visibleModels,
  };
  settings.agentSettings = agentSettings;
  return agentSettings;
}

/**
 * Keep `PiviSettings.model` and `agentSettings.visibleModels[0]` aligned.
 * Returns true when settings were mutated.
 */
export function reconcileActiveModelFields(
  settings: ActiveModelSettingsBag,
): boolean {
  let changed = false;
  const agentSettings = ensureAgentSettings(settings);
  const trimmedModel =
    typeof settings.model === "string" ? settings.model.trim() : "";
  const primaryVisible = agentSettings.visibleModels[0]?.trim() ?? "";

  if (trimmedModel) {
    if (settings.model !== trimmedModel) {
      settings.model = trimmedModel;
      changed = true;
    }
    if (agentSettings.visibleModels[0] !== trimmedModel) {
      agentSettings.visibleModels = [
        trimmedModel,
        ...agentSettings.visibleModels.filter(
          (model) => model !== trimmedModel,
        ),
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
    ...agentSettings.visibleModels.filter(
      (model) => model !== DEFAULT_MODEL_KEY,
    ),
  ];
  return true;
}

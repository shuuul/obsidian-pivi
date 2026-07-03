import { reconcileActiveModelFields } from './activeModel';
import type { ChatUIConfig } from './chatUi';


function normalizeReasoningValue(
  uiConfig: ChatUIConfig,
  settings: Record<string, unknown>,
  model: string,
  value: unknown,
): string {
  const allowedValues = new Set(
    uiConfig.getReasoningOptions(model, settings).map((option) => option.value),
  );
  if (typeof value === 'string' && allowedValues.has(value)) {
    return value;
  }
  return uiConfig.getDefaultReasoningValue(model, settings);
}

export function reconcileTitleGenerationModelSelection(
  settings: Record<string, unknown>,
  uiConfig: ChatUIConfig,
): boolean {
  const currentModel =
    typeof settings.titleGenerationModel === 'string'
      ? settings.titleGenerationModel
      : '';
  if (!currentModel) {
    return false;
  }

  const isValid = uiConfig
    .getModelOptions(settings)
    .some((option) => option.value === currentModel);
  if (isValid) {
    return false;
  }

  settings.titleGenerationModel = '';
  return true;
}

export function projectActiveChatState(
  settings: Record<string, unknown>,
  uiConfig: ChatUIConfig,
): void {
  const modelOptions = uiConfig.getModelOptions(settings);
  const currentModel = typeof settings.model === 'string' ? settings.model.trim() : '';
  const model =
    currentModel.length > 0 &&
    modelOptions.some((option) => option.value === currentModel)
      ? currentModel
      : (modelOptions[0]?.value ?? currentModel);

  if (model) {
    settings.model = model;
    uiConfig.applyModelDefaults(model, settings);
  }

  const isAdaptive =
    Boolean(model) && uiConfig.isAdaptiveReasoningModel(model, settings);

  if (isAdaptive) {
    settings.thinkingLevel = normalizeReasoningValue(
      uiConfig,
      settings,
      model,
      settings.thinkingLevel ?? settings.effortLevel,
    );
    delete settings.effortLevel;
  }

  if (!isAdaptive && model) {
    settings.thinkingBudget = normalizeReasoningValue(
      uiConfig,
      settings,
      model,
      settings.thinkingBudget,
    );
  } else if (!model) {
    settings.thinkingBudget = settings.thinkingBudget ?? 'off';
  }

  reconcileActiveModelFields(settings);
}

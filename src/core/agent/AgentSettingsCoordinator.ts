import { reconcileActiveModelFields } from '../settings/activeModel';
import type { OpenSessionState,PiviSettings } from '../types';
import { AgentServices } from './AgentServices';
import type { ChatUIConfig } from './types';

export interface SettingsReconciliationResult {
  changed: boolean;
  invalidatedSessions: OpenSessionState[];
}

function normalizeToggleValue(
  value: unknown,
  allowedValues: Set<string>,
): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  return allowedValues.has(value) ? value : undefined;
}

function normalizeReasoningValue(
  uiConfig: ChatUIConfig,
  settings: Record<string, unknown>,
  model: string,
  value: unknown,
): string {
  const allowedValues = new Set(uiConfig.getReasoningOptions(model, settings).map(option => option.value));
  if (typeof value === 'string' && allowedValues.has(value)) {
    return value;
  }
  return uiConfig.getDefaultReasoningValue(model, settings);
}

function normalizeAgentModel(
  uiConfig: ChatUIConfig,
  settings: Record<string, unknown>,
  model: string | undefined,
): string | undefined {
  if (!model) {
    return undefined;
  }
  return uiConfig.normalizeModelVariant(model, settings);
}

function asPiviSettingsForActiveModelReconciliation(settings: Record<string, unknown>): PiviSettings {
  // This coordinator only mutates the model/reasoning projection fields that are
  // shared with PiviSettings; the full settings bag may still contain provider
  // extension fields and partially migrated JSON at this boundary.
  return settings as PiviSettings;
}

function projectActiveState(settings: Record<string, unknown>): void {
  const uiConfig = AgentServices.getChatUIConfig();
  const modelOptions = uiConfig.getModelOptions(settings);
  const currentModelRaw = typeof settings.model === 'string' ? settings.model : '';
  const currentModel = normalizeAgentModel(uiConfig, settings, currentModelRaw) ?? '';
  const model = currentModel.length > 0 && modelOptions.some(option => option.value === currentModel)
    ? currentModel
    : (modelOptions[0]?.value ?? currentModel);

  if (model) {
    settings.model = model;
    uiConfig.applyModelDefaults(model, settings);
  }

  const isAdaptive = Boolean(model) && uiConfig.isAdaptiveReasoningModel(model, settings);

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

  const permissionToggle = uiConfig.getPermissionModeToggle?.() ?? null;
  if (!permissionToggle) {
    return;
  }

  const allowedPermissionModes = new Set([
    permissionToggle.inactiveValue,
    permissionToggle.activeValue,
    ...(permissionToggle.planValue ? [permissionToggle.planValue] : []),
  ]);
  const projectedPermissionMode = normalizeToggleValue(settings.permissionMode, allowedPermissionModes)
    ?? normalizeToggleValue(uiConfig.resolvePermissionMode?.(settings), allowedPermissionModes);

  if (projectedPermissionMode !== undefined) {
    settings.permissionMode = projectedPermissionMode;
  }

  reconcileActiveModelFields(asPiviSettingsForActiveModelReconciliation(settings));
}

export class AgentSettingsCoordinator {
  static handleEnvironmentChange(settings: Record<string, unknown>): boolean {
    return AgentServices.getSettingsReconciler().handleEnvironmentChange?.(settings) ?? false;
  }

  static reconcileTitleGenerationModelSelection(settings: Record<string, unknown>): boolean {
    const currentModel = typeof settings.titleGenerationModel === 'string'
      ? settings.titleGenerationModel
      : '';
    if (!currentModel) {
      return false;
    }

    const isValid = AgentServices.getChatUIConfig()
      .getModelOptions(settings)
      .some((option) => option.value === currentModel);
    if (isValid) {
      return false;
    }

    settings.titleGenerationModel = '';
    return true;
  }

  static getAgentSettingsSnapshot<T extends Record<string, unknown>>(settings: T): T {
    const snapshot = { ...settings };
    projectActiveState(snapshot);
    return snapshot;
  }

  static commitAgentSettingsSnapshot(
    settings: Record<string, unknown>,
    snapshot: Record<string, unknown>,
  ): void {
    Object.assign(settings, snapshot);
  }

  static reconcileAgentSettings(
    settings: Record<string, unknown>,
    sessions: OpenSessionState[],
  ): SettingsReconciliationResult {
    const reconciler = AgentServices.getSettingsReconciler();
    const { changed, invalidatedSessions } = reconciler.reconcileModelWithEnvironment(
      settings,
      sessions,
    );

    const titleChanged = this.reconcileTitleGenerationModelSelection(settings);

    return {
      changed: changed || titleChanged,
      invalidatedSessions,
    };
  }

  static normalizeAllModelVariants(settings: Record<string, unknown>): boolean {
    const changed = AgentServices.getSettingsReconciler().normalizeModelVariantSettings(settings);
    const titleChanged = this.reconcileTitleGenerationModelSelection(settings);
    return changed || titleChanged;
  }

  static projectActiveAgentState(settings: Record<string, unknown>): void {
    projectActiveState(settings);
  }
}

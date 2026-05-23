import type { Conversation } from '../types';
import { ProviderRegistry } from './ProviderRegistry';
import type { ProviderChatUIConfig } from './types';

export interface SettingsReconciliationResult {
  changed: boolean;
  invalidatedConversations: Conversation[];
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
  uiConfig: ProviderChatUIConfig,
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

function normalizeProviderModel(
  uiConfig: ProviderChatUIConfig,
  settings: Record<string, unknown>,
  model: string | undefined,
): string | undefined {
  if (!model) {
    return undefined;
  }
  return uiConfig.normalizeModelVariant(model, settings);
}

function projectActiveState(settings: Record<string, unknown>): void {
  const uiConfig = ProviderRegistry.getChatUIConfig();
  const modelOptions = uiConfig.getModelOptions(settings);
  const currentModelRaw = typeof settings.model === 'string' ? settings.model : '';
  const currentModel = normalizeProviderModel(uiConfig, settings, currentModelRaw) ?? '';
  const model = currentModel.length > 0 && modelOptions.some(option => option.value === currentModel)
    ? currentModel
    : (modelOptions[0]?.value ?? currentModel);

  if (model) {
    settings.model = model;
    uiConfig.applyModelDefaults(model, settings);
  }

  const serviceTierToggle = uiConfig.getServiceTierToggle?.(settings) ?? null;
  const isAdaptive = Boolean(model) && uiConfig.isAdaptiveReasoningModel(model, settings);

  if (isAdaptive) {
    settings.effortLevel = normalizeReasoningValue(
      uiConfig,
      settings,
      model,
      settings.effortLevel,
    );
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

  settings.serviceTier = typeof settings.serviceTier === 'string'
    ? settings.serviceTier
    : (serviceTierToggle?.inactiveValue ?? 'default');

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
}

export class ProviderSettingsCoordinator {
  static handleEnvironmentChange(settings: Record<string, unknown>): boolean {
    return ProviderRegistry.getSettingsReconciler().handleEnvironmentChange?.(settings) ?? false;
  }

  static reconcileTitleGenerationModelSelection(settings: Record<string, unknown>): boolean {
    const currentModel = typeof settings.titleGenerationModel === 'string'
      ? settings.titleGenerationModel
      : '';
    if (!currentModel) {
      return false;
    }

    const isValid = ProviderRegistry.getChatUIConfig()
      .getModelOptions(settings)
      .some((option) => option.value === currentModel);
    if (isValid) {
      return false;
    }

    settings.titleGenerationModel = '';
    return true;
  }

  static getProviderSettingsSnapshot<T extends Record<string, unknown>>(settings: T): T {
    const snapshot = { ...settings };
    projectActiveState(snapshot);
    return snapshot;
  }

  static commitProviderSettingsSnapshot(
    settings: Record<string, unknown>,
    snapshot: Record<string, unknown>,
  ): void {
    Object.assign(settings, snapshot);
  }

  static persistProjectedProviderState(_settings: Record<string, unknown>): void {
    // Single-provider settings are stored directly on the top-level settings bag.
  }

  static projectProviderState(settings: Record<string, unknown>): void {
    projectActiveState(settings);
  }

  static reconcileAllProviders(
    settings: Record<string, unknown>,
    conversations: Conversation[],
  ): SettingsReconciliationResult {
    const reconciler = ProviderRegistry.getSettingsReconciler();
    const { changed, invalidatedConversations } = reconciler.reconcileModelWithEnvironment(
      settings,
      conversations,
    );

    const titleChanged = this.reconcileTitleGenerationModelSelection(settings);

    return {
      changed: changed || titleChanged,
      invalidatedConversations,
    };
  }

  static normalizeAllModelVariants(settings: Record<string, unknown>): boolean {
    const changed = ProviderRegistry.getSettingsReconciler().normalizeModelVariantSettings(settings);
    const titleChanged = this.reconcileTitleGenerationModelSelection(settings);
    return changed || titleChanged;
  }

  static projectActiveProviderState(settings: Record<string, unknown>): void {
    projectActiveState(settings);
  }
}

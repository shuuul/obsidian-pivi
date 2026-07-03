import type { ChatUIConfig } from '@pivi/pivi-agent-core/foundation/chatUi';
import { projectActiveChatState, reconcileTitleGenerationModelSelection } from '@pivi/pivi-agent-core/foundation/chatUiProjection';
import { DEFAULT_MODEL_KEY } from '@pivi/pivi-agent-core/foundation/settingsDefaults';

const ADAPTIVE_MODEL = 'provider/adaptive-model';
const STANDARD_MODEL = 'provider/standard-model';

const adaptiveReasoningOptions = [
  { value: 'off', label: 'Off' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
];

const standardBudgetOptions = [
  { value: 'off', label: 'Off' },
  { value: 'low', label: 'Low' },
];

function readVisibleModels(settings: Record<string, unknown>): string[] {
  const agentSettings = settings.agentSettings;
  if (!agentSettings || typeof agentSettings !== 'object' || !('visibleModels' in agentSettings)) {
    return [];
  }
  const visibleModels = agentSettings.visibleModels;
  return Array.isArray(visibleModels)
    ? visibleModels.filter((model): model is string => typeof model === 'string')
    : [];
}

interface FakeChatUiConfigOptions {
  adaptiveModels?: Set<string>;
  applyModelDefaults?: jest.Mock<void, [string, unknown]>;
}

function createFakeChatUiConfig(options: FakeChatUiConfigOptions = {}): ChatUIConfig {
  const adaptiveModels = options.adaptiveModels ?? new Set([ADAPTIVE_MODEL]);
  const applyModelDefaults =
    options.applyModelDefaults ?? jest.fn<void, [string, unknown]>();

  return {
    getModelOptions: () => [
      { value: ADAPTIVE_MODEL, label: 'Adaptive' },
      { value: STANDARD_MODEL, label: 'Standard' },
    ],
    isAdaptiveReasoningModel: (model) => adaptiveModels.has(model),
    getReasoningOptions: (model) =>
      adaptiveModels.has(model) ? adaptiveReasoningOptions : standardBudgetOptions,
    getDefaultReasoningValue: (model) =>
      adaptiveModels.has(model) ? 'medium' : 'off',
    getContextWindowSize: () => 128_000,
    isDefaultModel: (model) => model === STANDARD_MODEL,
    applyModelDefaults,
  };
}

describe('projectActiveChatState', () => {
  it('falls back to the first selectable model and applies model defaults', () => {
    const applyModelDefaults = jest.fn<void, [string, unknown]>();
    const uiConfig = createFakeChatUiConfig({ applyModelDefaults });
    const settings: Record<string, unknown> = { model: 'provider/removed-from-pool' };

    projectActiveChatState(settings, uiConfig);

    expect(settings.model).toBe(ADAPTIVE_MODEL);
    expect(applyModelDefaults).toHaveBeenCalledWith(ADAPTIVE_MODEL, settings);
  });

  it('keeps a trimmed model when it remains in the option pool', () => {
    const applyModelDefaults = jest.fn<void, [string, unknown]>();
    const uiConfig = createFakeChatUiConfig({ applyModelDefaults });
    const settings: Record<string, unknown> = { model: `  ${STANDARD_MODEL}  ` };

    projectActiveChatState(settings, uiConfig);

    expect(settings.model).toBe(STANDARD_MODEL);
    expect(applyModelDefaults).toHaveBeenCalledWith(STANDARD_MODEL, settings);
  });

  it('projects adaptive thinkingLevel from effortLevel and removes effortLevel', () => {
    const uiConfig = createFakeChatUiConfig();
    const settings: Record<string, unknown> = {
      model: ADAPTIVE_MODEL,
      effortLevel: 'high',
    };

    projectActiveChatState(settings, uiConfig);

    expect(settings.thinkingLevel).toBe('high');
    expect(settings).not.toHaveProperty('effortLevel');
  });

  it('clamps invalid adaptive thinkingLevel to the configured default', () => {
    const uiConfig = createFakeChatUiConfig();
    const settings: Record<string, unknown> = {
      model: ADAPTIVE_MODEL,
      thinkingLevel: 'not-a-level',
    };

    projectActiveChatState(settings, uiConfig);

    expect(settings.thinkingLevel).toBe('medium');
  });

  it('normalizes thinkingBudget for non-adaptive models', () => {
    const uiConfig = createFakeChatUiConfig();
    const settings: Record<string, unknown> = {
      model: STANDARD_MODEL,
      thinkingBudget: 'high',
    };

    projectActiveChatState(settings, uiConfig);

    expect(settings.thinkingBudget).toBe('off');
  });

  it('defaults thinkingBudget to off when no model is selected', () => {
    const uiConfig = createFakeChatUiConfig({
      adaptiveModels: new Set(),
    });
    const uiConfigNoModels: ChatUIConfig = {
      ...uiConfig,
      getModelOptions: () => [],
    };
    const settings: Record<string, unknown> = { model: 'provider/orphan' };

    projectActiveChatState(settings, uiConfigNoModels);

    expect(settings.thinkingBudget).toBe('off');
  });

  it('reconciles model with agentSettings.visibleModels primary entry', () => {
    const uiConfig = createFakeChatUiConfig();
    const settings: Record<string, unknown> = {
      model: STANDARD_MODEL,
      agentSettings: {
        visibleModels: [ADAPTIVE_MODEL, STANDARD_MODEL],
      },
    };

    projectActiveChatState(settings, uiConfig);

    expect(settings.model).toBe(STANDARD_MODEL);
    expect(readVisibleModels(settings)).toEqual([STANDARD_MODEL, ADAPTIVE_MODEL]);
  });
  it('uses visibleModels primary when model is empty and no model options exist', () => {
    const uiConfig = createFakeChatUiConfig();
    const uiConfigNoPool: ChatUIConfig = {
      ...uiConfig,
      getModelOptions: () => [],
    };
    const settings: Record<string, unknown> = {
      model: '',
      agentSettings: {
        visibleModels: [STANDARD_MODEL],
      },
    };

    projectActiveChatState(settings, uiConfigNoPool);

    expect(settings.model).toBe(STANDARD_MODEL);
    expect(readVisibleModels(settings)[0]).toBe(STANDARD_MODEL);
  });

  it('falls back to DEFAULT_MODEL_KEY when model, visibleModels, and model options are empty', () => {
    const uiConfig = createFakeChatUiConfig();
    const uiConfigNoPool: ChatUIConfig = {
      ...uiConfig,
      getModelOptions: () => [],
    };
    const settings: Record<string, unknown> = {
      model: '',
      agentSettings: {
        visibleModels: [],
      },
    };

    projectActiveChatState(settings, uiConfigNoPool);

    expect(settings.model).toBe(DEFAULT_MODEL_KEY);
    expect(readVisibleModels(settings)[0]).toBe(DEFAULT_MODEL_KEY);
  });
});

describe('reconcileTitleGenerationModelSelection', () => {
  it('keeps a valid title-generation model without mutation', () => {
    const uiConfig = createFakeChatUiConfig();
    const settings: Record<string, unknown> = { titleGenerationModel: STANDARD_MODEL };

    expect(reconcileTitleGenerationModelSelection(settings, uiConfig)).toBe(false);
    expect(settings.titleGenerationModel).toBe(STANDARD_MODEL);
  });

  it('clears an invalid title-generation model and reports a change', () => {
    const uiConfig = createFakeChatUiConfig();
    const settings: Record<string, unknown> = { titleGenerationModel: 'provider/removed' };

    expect(reconcileTitleGenerationModelSelection(settings, uiConfig)).toBe(true);
    expect(settings.titleGenerationModel).toBe('');
  });

  it('leaves empty and non-string title-generation models unchanged', () => {
    const uiConfig = createFakeChatUiConfig();
    const emptySettings: Record<string, unknown> = { titleGenerationModel: '' };
    const nonStringSettings: Record<string, unknown> = { titleGenerationModel: 42 };

    expect(reconcileTitleGenerationModelSelection(emptySettings, uiConfig)).toBe(false);
    expect(emptySettings.titleGenerationModel).toBe('');
    expect(reconcileTitleGenerationModelSelection(nonStringSettings, uiConfig)).toBe(false);
    expect(nonStringSettings.titleGenerationModel).toBe(42);
  });
});
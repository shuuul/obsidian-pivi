import type { ChatUIConfig } from '@pivi/pivi-agent-core/foundation/chatUi';
import {
  commitSettingsSnapshot,
  getProjectedSettingsSnapshot,
  reconcileSettingsWithChatUi,
} from '@pivi/pivi-agent-core/foundation/settingsCoordinator';
import type { OpenSessionState } from '@pivi/pivi-agent-core/foundation/chat';

const ADAPTIVE_MODEL = 'provider/adaptive-model';
const STANDARD_MODEL = 'provider/standard-model';

const adaptiveReasoningOptions = [
  { value: 'off', label: 'Off' },
  { value: 'medium', label: 'Medium' },
];

const standardBudgetOptions = [
  { value: 'off', label: 'Off' },
  { value: 'low', label: 'Low' },
];

function createFakeChatUiConfig(adaptiveModels = new Set([ADAPTIVE_MODEL])): ChatUIConfig {
  const applyModelDefaults = jest.fn<void, [string, unknown]>();

  return {
    getModelOptions: () => [
      { value: ADAPTIVE_MODEL, label: 'Adaptive' },
      { value: STANDARD_MODEL, label: 'Standard' },
    ],
    isAdaptiveReasoningModel: (model) => adaptiveModels.has(model),
    getReasoningOptions: (model) =>
      adaptiveModels.has(model) ? adaptiveReasoningOptions : standardBudgetOptions,
    getDefaultReasoningValue: (model) => (adaptiveModels.has(model) ? 'medium' : 'off'),
    getContextWindowSize: () => 128_000,
    isDefaultModel: (model) => model === STANDARD_MODEL,
    applyModelDefaults,
  };
}

describe('getProjectedSettingsSnapshot', () => {
  it('returns a projected copy without mutating the source settings object', () => {
    const uiConfig = createFakeChatUiConfig();
    const settings: Record<string, unknown> = {
      model: ADAPTIVE_MODEL,
      thinkingLevel: 'off',
    };
    const before = { ...settings };

    const snapshot = getProjectedSettingsSnapshot(settings, uiConfig);

    expect(settings).toEqual(before);
    expect(snapshot).not.toBe(settings);
    expect(snapshot.thinkingLevel).toBe('off');
  });

  it('projects unknown model to the first selectable option in the snapshot only', () => {
    const uiConfig = createFakeChatUiConfig();
    const settings: Record<string, unknown> = { model: 'provider/removed-from-pool' };

    const snapshot = getProjectedSettingsSnapshot(settings, uiConfig);

    expect(settings.model).toBe('provider/removed-from-pool');
    expect(snapshot.model).toBe(ADAPTIVE_MODEL);
  });
});

describe('commitSettingsSnapshot', () => {
  it('copies snapshot fields onto the live settings bag', () => {
    const settings: Record<string, unknown> = {
      model: ADAPTIVE_MODEL,
      thinkingBudget: 'off',
    };
    const snapshot = {
      model: STANDARD_MODEL,
      thinkingBudget: 'low',
    };
    commitSettingsSnapshot(settings, snapshot);

    expect(settings.model).toBe(STANDARD_MODEL);
    expect(settings.thinkingBudget).toBe('low');
  });
});

describe('reconcileSettingsWithChatUi', () => {
  const sessions = [{ id: 'tab-1' } as OpenSessionState];

  it('reports changed when title model is cleared and does not invalidate sessions', () => {
    const uiConfig = createFakeChatUiConfig();
    const settings: Record<string, unknown> = { titleGenerationModel: 'provider/stale-title' };

    const result = reconcileSettingsWithChatUi(settings, sessions, uiConfig);

    expect(result.changed).toBe(true);
    expect(result.invalidatedSessions).toEqual([]);
    expect(settings.titleGenerationModel).toBe('');
  });

  it('reports unchanged when title model reconciliation is a no-op', () => {
    const uiConfig = createFakeChatUiConfig();
    const settings: Record<string, unknown> = { titleGenerationModel: STANDARD_MODEL };

    const result = reconcileSettingsWithChatUi(settings, [], uiConfig);

    expect(result.changed).toBe(false);
    expect(result.invalidatedSessions).toEqual([]);
    expect(settings.titleGenerationModel).toBe(STANDARD_MODEL);
  });
});
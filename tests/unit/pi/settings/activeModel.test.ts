import { DEFAULT_PIVI_SETTINGS } from '@pivi/pivi-agent-core/foundation/settingsDefaults';
import { reconcileActiveModelFields } from '@pivi/pivi-agent-core/foundation/activeModel';
import { DEFAULT_MODEL_KEY } from '@pivi/pivi-agent-core/foundation/settingsDefaults';
import type { PiviSettings } from '@pivi/pivi-agent-core/foundation/settings';

function settingsFixture(overrides: Partial<PiviSettings> = {}): PiviSettings {
  return {
    ...DEFAULT_PIVI_SETTINGS,
    ...overrides,
    agentSettings: {
      ...DEFAULT_PIVI_SETTINGS.agentSettings,
      ...(overrides.agentSettings ?? {}),
    },
  };
}

describe('reconcileActiveModelFields', () => {
  it('promotes top-level model to visibleModels head', () => {
    const settings = settingsFixture({
      model: 'openai/gpt-4.1',
      agentSettings: {
        ...DEFAULT_PIVI_SETTINGS.agentSettings,
        visibleModels: ['opencode-go/deepseek-v4-flash'],
      },
    });

    expect(reconcileActiveModelFields(settings)).toBe(true);
    expect(settings.agentSettings.visibleModels[0]).toBe('openai/gpt-4.1');
  });

  it('fills model from visibleModels when top-level is empty', () => {
    const settings = settingsFixture({
      model: '',
      agentSettings: {
        ...DEFAULT_PIVI_SETTINGS.agentSettings,
        visibleModels: ['openai-codex/gpt-5.4'],
      },
    });

    expect(reconcileActiveModelFields(settings)).toBe(true);
    expect(settings.model).toBe('openai-codex/gpt-5.4');
  });

  it('uses default when both fields are missing', () => {
    const settings = settingsFixture({
      model: '',
      agentSettings: {
        ...DEFAULT_PIVI_SETTINGS.agentSettings,
        visibleModels: [],
      },
    });

    expect(reconcileActiveModelFields(settings)).toBe(true);
    expect(settings.model).toBe(DEFAULT_MODEL_KEY);
    expect(settings.agentSettings.visibleModels[0]).toBe(DEFAULT_MODEL_KEY);
  });
});

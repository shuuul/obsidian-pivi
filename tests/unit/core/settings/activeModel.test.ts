import { DEFAULT_OBSIUS_SETTINGS } from '../../../../src/app/settings/defaultSettings';
import { reconcileActiveModelFields } from '../../../../src/core/settings/activeModel';
import { DEFAULT_MODEL_KEY } from '../../../../src/core/settings/agentDefaults';
import type { ObsiusSettings } from '../../../../src/core/types/settings';

function settingsFixture(overrides: Partial<ObsiusSettings> = {}): ObsiusSettings {
  return {
    ...DEFAULT_OBSIUS_SETTINGS,
    ...overrides,
    agentSettings: {
      ...DEFAULT_OBSIUS_SETTINGS.agentSettings,
      ...(overrides.agentSettings ?? {}),
    },
  };
}

describe('reconcileActiveModelFields', () => {
  it('promotes top-level model to visibleModels head', () => {
    const settings = settingsFixture({
      model: 'openai/gpt-4.1',
      agentSettings: {
        ...DEFAULT_OBSIUS_SETTINGS.agentSettings,
        visibleModels: ['anthropic/claude-sonnet-4-20250514'],
      },
    });

    expect(reconcileActiveModelFields(settings)).toBe(true);
    expect(settings.agentSettings.visibleModels[0]).toBe('openai/gpt-4.1');
  });

  it('fills model from visibleModels when top-level is empty', () => {
    const settings = settingsFixture({
      model: '',
      agentSettings: {
        ...DEFAULT_OBSIUS_SETTINGS.agentSettings,
        visibleModels: ['google/gemini-2.5-pro'],
      },
    });

    expect(reconcileActiveModelFields(settings)).toBe(true);
    expect(settings.model).toBe('google/gemini-2.5-pro');
  });

  it('uses default when both fields are missing', () => {
    const settings = settingsFixture({
      model: '',
      agentSettings: {
        ...DEFAULT_OBSIUS_SETTINGS.agentSettings,
        visibleModels: [],
      },
    });

    expect(reconcileActiveModelFields(settings)).toBe(true);
    expect(settings.model).toBe(DEFAULT_MODEL_KEY);
    expect(settings.agentSettings.visibleModels[0]).toBe(DEFAULT_MODEL_KEY);
  });
});

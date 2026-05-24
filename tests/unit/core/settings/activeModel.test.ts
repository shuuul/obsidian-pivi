import { DEFAULT_MODEL_KEY } from '../../../../src/core/settings/agentDefaults';
import { reconcileActiveModelFields } from '../../../../src/core/settings/activeModel';
import type { ObsiusSettings } from '../../../../src/core/types/settings';
import { DEFAULT_OBSIUS_SETTINGS } from '../../../../src/app/settings/defaultSettings';

function settingsFixture(overrides: Partial<ObsiusSettings> = {}): ObsiusSettings {
  return {
    ...DEFAULT_OBSIUS_SETTINGS,
    ...overrides,
    piSettings: {
      ...DEFAULT_OBSIUS_SETTINGS.piSettings,
      ...(overrides.piSettings ?? {}),
    },
  };
}

describe('reconcileActiveModelFields', () => {
  it('promotes top-level model to visibleModels head', () => {
    const settings = settingsFixture({
      model: 'openai/gpt-4.1',
      piSettings: {
        ...DEFAULT_OBSIUS_SETTINGS.piSettings,
        visibleModels: ['anthropic/claude-sonnet-4-20250514'],
      },
    });

    expect(reconcileActiveModelFields(settings)).toBe(true);
    expect(settings.piSettings.visibleModels[0]).toBe('openai/gpt-4.1');
  });

  it('fills model from visibleModels when top-level is empty', () => {
    const settings = settingsFixture({
      model: '',
      piSettings: {
        ...DEFAULT_OBSIUS_SETTINGS.piSettings,
        visibleModels: ['google/gemini-2.5-pro'],
      },
    });

    expect(reconcileActiveModelFields(settings)).toBe(true);
    expect(settings.model).toBe('google/gemini-2.5-pro');
  });

  it('uses default when both fields are missing', () => {
    const settings = settingsFixture({
      model: '',
      piSettings: {
        ...DEFAULT_OBSIUS_SETTINGS.piSettings,
        visibleModels: [],
      },
    });

    expect(reconcileActiveModelFields(settings)).toBe(true);
    expect(settings.model).toBe(DEFAULT_MODEL_KEY);
    expect(settings.piSettings.visibleModels[0]).toBe(DEFAULT_MODEL_KEY);
  });
});

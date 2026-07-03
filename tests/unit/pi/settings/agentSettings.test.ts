import {
  DEFAULT_MODEL_KEY,
  DEFAULT_PI_PROVIDER_IDS,
  PI_DEFAULT_ENVIRONMENT_VARIABLES,
} from '@pivi/pivi-agent-core/foundation/settingsDefaults';
import { isValidModelKey } from '@pivi/pivi-agent-core/foundation/settingsModelKey';
import {
  getPiAgentSettings,
  normalizePiAgentSettingsRecord,
  updatePiAgentSettings,
} from '@pivi/pivi-agent-core/foundation/agentSettings';


function isPersistedAgentSettings(
  value: unknown,
): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function readPersistedAgentSettings(
  settings: Record<string, unknown>,
): Record<string, unknown> | null {
  const candidate = settings.agentSettings;
  if (!isPersistedAgentSettings(candidate)) {
    return null;
  }
  return candidate;
}

describe('isValidModelKey', () => {
  it.each([
    { key: 'anthropic/claude', valid: true },
    { key: 'opencode-go/deepseek-v4-flash', valid: true },
    { key: 'no-slash', valid: false },
    { key: 'trailing/', valid: false },
    { key: '/leading', valid: false },
    { key: '', valid: false },
  ])('treats $key as valid=$valid', ({ key, valid }) => {
    expect(isValidModelKey(key)).toBe(valid);
  });
});

describe('getPiAgentSettings', () => {
  it('materializes defaults when agentSettings is missing', () => {
    const settings: Record<string, unknown> = {};
    const view = getPiAgentSettings(settings);

    expect(view.addedProviders).toEqual([...DEFAULT_PI_PROVIDER_IDS]);
    expect(view.disabledProviders).toEqual([]);
    expect(view.environmentVariables).toBe(PI_DEFAULT_ENVIRONMENT_VARIABLES);
    expect(view.selectedMode).toBe('default');
    expect(view.visibleModels).toEqual([DEFAULT_MODEL_KEY]);
    expect(view.availableModes).toEqual(['default']);
    expect(view.discoveredModels).toEqual([DEFAULT_MODEL_KEY]);

    const persisted = readPersistedAgentSettings(settings);
    expect(persisted).not.toBeNull();
    expect(persisted?.visibleModels).toEqual([DEFAULT_MODEL_KEY]);
  });

  it('drops unsupported providers from added and disabled lists', () => {
    const settings = {
      agentSettings: {
        environmentVariables: '',
        selectedMode: 'default',
        visibleModels: [DEFAULT_MODEL_KEY],
        addedProviders: ['anthropic', 'not-a-provider'],
        disabledProviders: ['openrouter', 'bogus'],
      },
    };

    const view = getPiAgentSettings(settings);

    expect(view.addedProviders).toEqual(['anthropic']);
    expect(view.disabledProviders).toEqual(['openrouter']);
  });

  it('falls back to default visible models when every entry is invalid', () => {
    const settings = {
      agentSettings: {
        environmentVariables: '',
        selectedMode: 'default',
        visibleModels: ['no-slash', 'unknown-provider/model'],
      },
    };

    expect(getPiAgentSettings(settings).visibleModels).toEqual([DEFAULT_MODEL_KEY]);
  });

  it('keeps only supported provider model keys in visibleModels', () => {
    const settings = {
      agentSettings: {
        environmentVariables: '',
        selectedMode: 'default',
        visibleModels: [
          'anthropic/claude-3',
          'fake-vendor/model',
          'openrouter/openai/gpt-4.1',
        ],
      },
    };

    expect(getPiAgentSettings(settings).visibleModels).toEqual([
      'anthropic/claude-3',
      'openrouter/openai/gpt-4.1',
    ]);
  });

  it('uses legacy top-level PI-scoped env when agent block omits environmentVariables', () => {
    const settings = {
      environmentVariables: 'PI_TOKEN=from-legacy',
      agentSettings: {
        selectedMode: 'default',
        visibleModels: [DEFAULT_MODEL_KEY],
      },
    };

    expect(getPiAgentSettings(settings).environmentVariables).toBe('PI_TOKEN=from-legacy');
  });
});

describe('updatePiAgentSettings', () => {
  it('merges partial updates and persists on the settings bag', () => {
    const settings: Record<string, unknown> = {};
    updatePiAgentSettings(settings, {
      disabledProviders: ['anthropic'],
      visibleModels: ['openrouter/openai/gpt-4.1'],
    });

    const view = getPiAgentSettings(settings);
    expect(view.disabledProviders).toEqual(['anthropic']);
    expect(view.visibleModels).toEqual(['openrouter/openai/gpt-4.1']);

    const persisted = readPersistedAgentSettings(settings);
    expect(persisted?.disabledProviders).toEqual(['anthropic']);
    expect(persisted?.visibleModels).toEqual(['openrouter/openai/gpt-4.1']);
  });

  it('writes lastModel and environmentHash onto the persisted record', () => {
    const settings: Record<string, unknown> = {};
    updatePiAgentSettings(settings, {
      lastModel: 'anthropic/claude-3',
      environmentHash: 'hash-abc',
      visibleModels: [DEFAULT_MODEL_KEY],
      environmentVariables: '',
      selectedMode: 'default',
      addedProviders: [],
      disabledProviders: [],
    });

    const persisted = readPersistedAgentSettings(settings);
    expect(persisted?.lastModel).toBe('anthropic/claude-3');
    expect(persisted?.environmentHash).toBe('hash-abc');
  });

  it('returns the merged view without requiring a second get call', () => {
    const settings: Record<string, unknown> = {};
    const returned = updatePiAgentSettings(settings, {
      selectedMode: 'default',
      environmentVariables: 'FOO=bar',
      visibleModels: ['deepseek/chat'],
      addedProviders: ['deepseek'],
      disabledProviders: [],
    });

    expect(returned.environmentVariables).toBe('FOO=bar');
    expect(returned.visibleModels).toEqual(['deepseek/chat']);
    expect(returned.addedProviders).toEqual(['deepseek']);
  });
});

describe('normalizePiAgentSettingsRecord', () => {
  it('reports changed when corrupt agentSettings is repaired', () => {
    const settings = {
      agentSettings: null,
      model: 'anthropic/claude-3',
    };

    expect(normalizePiAgentSettingsRecord(settings)).toBe(true);
    expect(getPiAgentSettings(settings).visibleModels).toEqual([DEFAULT_MODEL_KEY]);
  });

  it('reports unchanged when record already matches normalized view', () => {
    const settings = {
      agentSettings: {
        environmentVariables: PI_DEFAULT_ENVIRONMENT_VARIABLES,
        selectedMode: 'default',
        visibleModels: [DEFAULT_MODEL_KEY],
        addedProviders: [...DEFAULT_PI_PROVIDER_IDS],
        disabledProviders: [],
      },
      model: DEFAULT_MODEL_KEY,
    };

    expect(normalizePiAgentSettingsRecord(settings)).toBe(false);
  });

  it('clears top-level model when provider is unsupported', () => {
    const settings = {
      agentSettings: {
        environmentVariables: '',
        selectedMode: 'default',
        visibleModels: [DEFAULT_MODEL_KEY],
      },
      model: 'unsupported-vendor/some-model',
    };

    normalizePiAgentSettingsRecord(settings);
    expect(settings.model).toBe('');
  });

  it('keeps top-level model when key uses a supported provider', () => {
    const settings = {
      agentSettings: {
        environmentVariables: '',
        selectedMode: 'default',
        visibleModels: [DEFAULT_MODEL_KEY],
      },
      model: 'anthropic/claude-3',
    };

    normalizePiAgentSettingsRecord(settings);
    expect(settings.model).toBe('anthropic/claude-3');
  });

  it('sanitizes visibleModels from source when normalizing', () => {
    const settings = {
      agentSettings: {
        environmentVariables: '',
        selectedMode: 'default',
        visibleModels: ['bad', 'anthropic/ok'],
      },
    };
    const source = { ...settings };

    expect(normalizePiAgentSettingsRecord(settings, source)).toBe(true);
    expect(getPiAgentSettings(settings).visibleModels).toEqual(['anthropic/ok']);
  });
});
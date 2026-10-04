import { PI_AI_MODELS_CACHE, type PiCachedModel } from '@pivi/engine-pi/models/piModelRegistry'
import {
  getPiSettingsSnapshot,
  projectActivePiState,
  reconcilePiTitleGenerationModel,
} from '@pivi/engine-pi/models/piSettingsCoordinator';
import { updatePiAgentSettings } from '@pivi/agent/settings/agentSettings';

const REASONING_MODEL = 'anthropic/claude-reasoning';
const STANDARD_MODEL = 'deepseek/deepseek-flash';

function cachedModel(
  provider: string,
  id: string,
  reasoning: boolean,
): PiCachedModel {
  return {
    provider,
    id,
    name: id,
    reasoning,
    contextWindow: 200_000,
  } as PiCachedModel;
}

function seedModelCache(): void {
  PI_AI_MODELS_CACHE.set(REASONING_MODEL, cachedModel('anthropic', 'claude-reasoning', true));
  PI_AI_MODELS_CACHE.set(STANDARD_MODEL, cachedModel('deepseek', 'deepseek-flash', false));
}

function clearModelCache(): void {
  PI_AI_MODELS_CACHE.delete(REASONING_MODEL);
  PI_AI_MODELS_CACHE.delete(STANDARD_MODEL);
}

function baseSettings(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const settings: Record<string, unknown> = {};
  updatePiAgentSettings(settings, {
    addedProviders: ['anthropic', 'deepseek'],
    disabledProviders: [],
    environmentVariables: '',
    visibleModels: [REASONING_MODEL, STANDARD_MODEL],
  });
  return { ...settings, model: REASONING_MODEL, ...overrides };
}


describe('Pi settings projection (piChatUIConfig wiring)', () => {
  beforeAll(() => seedModelCache());
  afterAll(() => clearModelCache());

  it('getPiSettingsSnapshot projects through piChatUIConfig without mutating source settings', () => {
    const settings = baseSettings({ model: 'anthropic/not-in-pool' });
    const before = { ...settings };

    const snapshot = getPiSettingsSnapshot(settings);

    expect(settings).toEqual(before);
    expect(snapshot.model).toBe(REASONING_MODEL);
  });

  it('projectActivePiState mutates settings using pi model cache-backed ui config', () => {
    const settings = baseSettings({
      model: '',
      agentSettings: {
        addedProviders: ['anthropic', 'deepseek'],
        disabledProviders: [],
        environmentVariables: '',
        visibleModels: [STANDARD_MODEL],
      },
    });

    projectActivePiState(settings);

    expect(settings.model).toBe(STANDARD_MODEL);
  });

  it('reconcilePiTitleGenerationModel clears a stale title model through piChatUIConfig', () => {
    const settings = baseSettings({ titleGenerationModel: 'anthropic/stale-title-model' });

    expect(reconcilePiTitleGenerationModel(settings)).toBe(true);
    expect(settings.titleGenerationModel).toBe('');
  });
});
import { piChatUIConfig } from '@pivi/engine-pi/piChatUiConfig';
import {
  PI_AI_MODELS_CACHE,
  type PiCachedModel,
} from '@pivi/engine-pi/piModelRegistry';

const MODEL_KEY = 'test-provider/large-model';

describe('piChatUIConfig context windows', () => {
  beforeEach(() => {
    PI_AI_MODELS_CACHE.set(MODEL_KEY, {
      provider: 'test-provider',
      id: 'large-model',
      name: 'Large model',
      reasoning: false,
      contextWindow: 1_000_000,
    } as PiCachedModel);
  });

  afterEach(() => {
    PI_AI_MODELS_CACHE.delete(MODEL_KEY);
  });

  it('prefers a user override over cached model metadata', () => {
    expect(piChatUIConfig.getContextWindowSize(MODEL_KEY, {
      [MODEL_KEY]: 128_000,
    })).toBe(128_000);
  });

  it('uses the selected model context window when there is no override', () => {
    expect(piChatUIConfig.getContextWindowSize(MODEL_KEY, {})).toBe(1_000_000);
  });

  it('groups custom provider models by the settings display name', () => {
    const providerId = 'custom-openai-compatible-lan';
    const modelKey = `${providerId}/qwen38-nvfp4`;
    PI_AI_MODELS_CACHE.set(modelKey, {
      provider: providerId,
      id: 'qwen38-nvfp4',
      name: 'qwen38-nvfp4',
      reasoning: false,
      contextWindow: 262_144,
    } as PiCachedModel);

    const options = piChatUIConfig.getModelOptions({
      agentSettings: {
        addedProviders: [providerId],
        disabledProviders: [],
        visibleModels: [modelKey],
        customProviders: [{
          id: providerId,
          kind: 'openai-compatible',
          name: 'Home vLLM',
          baseUrl: 'http://192.168.100.177:8888/v1',
          api: 'openai-completions',
          models: [{ id: 'qwen38-nvfp4', name: 'qwen38-nvfp4' }],
        }],
        environmentVariables: '',
        selectedMode: 'default',
      },
    });

    expect(options[0]).toMatchObject({
      value: modelKey,
      group: 'Home vLLM',
      providerLogoSlug: 'qwen',
    });
  });
});

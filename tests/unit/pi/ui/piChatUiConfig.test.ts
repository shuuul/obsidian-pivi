import { piChatUIConfig } from '@pivi/pivi-agent-core/engine/pi/piChatUiConfig';
import {
  PI_AI_MODELS_CACHE,
  type PiCachedModel,
} from '@pivi/pivi-agent-core/engine/pi/piModelRegistry';

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

  it('returns an explicit unknown result when the selected model cannot be resolved', () => {
    expect(piChatUIConfig.getContextWindowSize('missing-model', {})).toBeNull();
  });
});

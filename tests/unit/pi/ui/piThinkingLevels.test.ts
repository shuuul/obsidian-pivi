import { PI_AI_MODELS_CACHE, type PiCachedModel } from '../../../../src/pi/ui/PiChatUIConfig';
import {
  getPiDefaultThinkingLevel,
  getPiThinkingLevelOptions,
  isPiAdaptiveReasoningModel,
  resolvePiThinkingLevel,
} from '../../../../src/pi/ui/piThinkingLevels';

describe('piThinkingLevels', () => {
  const reasoningModelKey = 'anthropic/claude-sonnet-4-20250514';
  const standardModelKey = 'openai/gpt-4o';

  beforeAll(() => {
    PI_AI_MODELS_CACHE.set(reasoningModelKey, {
      provider: 'anthropic',
      id: 'claude-sonnet-4-20250514',
      reasoning: true,
      thinkingLevelMap: {},
    } as PiCachedModel);
    PI_AI_MODELS_CACHE.set(standardModelKey, {
      provider: 'openai',
      id: 'gpt-4o',
      reasoning: false,
    } as PiCachedModel);
  });

  afterAll(() => {
    PI_AI_MODELS_CACHE.delete(reasoningModelKey);
    PI_AI_MODELS_CACHE.delete(standardModelKey);
  });

  it('exposes thinking levels for reasoning models', () => {
    const options = getPiThinkingLevelOptions(reasoningModelKey);
    expect(options.length).toBeGreaterThan(1);
    expect(options.some((option) => option.value === 'high')).toBe(true);
    expect(options.find((option) => option.value === 'medium')?.label).toBe('Medium');
  });

  it('hides adaptive reasoning for non-reasoning models', () => {
    expect(isPiAdaptiveReasoningModel(standardModelKey)).toBe(false);
    expect(getPiThinkingLevelOptions(standardModelKey)).toEqual([
      expect.objectContaining({ value: 'off' }),
    ]);
  });

  it('clamps invalid thinking level to model-supported levels', () => {
    expect(resolvePiThinkingLevel(reasoningModelKey, 'high')).toBe('high');
    expect(resolvePiThinkingLevel(standardModelKey, 'high')).toBe('off');
    expect(getPiDefaultThinkingLevel(reasoningModelKey, 'bogus')).not.toBe('bogus');
  });
});

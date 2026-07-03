import {
  getPiDefaultThinkingLevelForModel,
  getPiThinkingLevelOptionsForModel,
  isPiAdaptiveReasoningModelValue,
  PI_AI_MODELS_CACHE,
  type PiCachedModel,
  resolvePiModelFromKeyWithLookup,
  resolvePiThinkingLevelForModel,
} from '@pivi/pivi-agent-core/engine/pi';
import { piAiModels } from '@pivi/pivi-agent-core/engine/pi/piAiModels';

function resolveTestModel(modelKey: string): PiCachedModel | null {
  return resolvePiModelFromKeyWithLookup(modelKey, piAiModels);
}

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
    const options = getPiThinkingLevelOptionsForModel(resolveTestModel(reasoningModelKey));
    expect(options.length).toBeGreaterThan(1);
    expect(options.some((option) => option.value === 'high')).toBe(true);
    expect(options.find((option) => option.value === 'medium')?.label).toBe('Medium');
  });

  it('enables adaptive reasoning for reasoning models', () => {
    expect(isPiAdaptiveReasoningModelValue(resolveTestModel(reasoningModelKey))).toBe(true);
  });

  it('hides adaptive reasoning for non-reasoning models', () => {
    expect(isPiAdaptiveReasoningModelValue(resolveTestModel(standardModelKey))).toBe(false);
    expect(getPiThinkingLevelOptionsForModel(resolveTestModel(standardModelKey))).toEqual([
      expect.objectContaining({ value: 'off' }),
    ]);
  });

  it('returns no thinking options for invalid model keys', () => {
    expect(getPiThinkingLevelOptionsForModel(resolveTestModel('missing-model'))).toEqual([]);
    expect(isPiAdaptiveReasoningModelValue(resolveTestModel('missing-model'))).toBe(false);
    expect(resolvePiThinkingLevelForModel(resolveTestModel('missing-model'), 'high')).toBe('off');
  });

  it('clamps invalid thinking level to model-supported levels', () => {
    expect(resolvePiThinkingLevelForModel(resolveTestModel(reasoningModelKey), 'high')).toBe('high');
    expect(resolvePiThinkingLevelForModel(resolveTestModel(standardModelKey), 'high')).toBe('off');
    expect(getPiDefaultThinkingLevelForModel(resolveTestModel(reasoningModelKey), 'bogus')).not.toBe('bogus');
  });
});

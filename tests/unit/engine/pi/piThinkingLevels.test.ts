import type { Api, Model } from '@earendil-works/pi-ai';

import {
  getPiDefaultThinkingLevelForModel,
  getPiThinkingLevelOptionsForModel,
  isPiAdaptiveReasoningModelValue,
  resolvePiThinkingLevelForModel,
} from '@pivi/pivi-agent-core/engine/pi/piThinkingLevels';

function reasoningFixture(): Model<Api> {
  return {
    provider: 'anthropic',
    id: 'claude-reasoning-fixture',
    reasoning: true,
    thinkingLevelMap: {},
  } as Model<Api>;
}

function standardFixture(): Model<Api> {
  return {
    provider: 'openai',
    id: 'gpt-standard-fixture',
    reasoning: false,
  } as Model<Api>;
}

describe('PiThinkingLevels (core)', () => {
  describe('getPiThinkingLevelOptionsForModel', () => {
    it('returns no options when model is null', () => {
      expect(getPiThinkingLevelOptionsForModel(null)).toEqual([]);
    });

    it('exposes multiple thinking levels for reasoning models', () => {
      const options = getPiThinkingLevelOptionsForModel(reasoningFixture());
      expect(options.length).toBeGreaterThan(1);
      expect(options.some((option) => option.value === 'high')).toBe(true);
      expect(options.find((option) => option.value === 'medium')?.label).toBe('Medium');
      // Upstream pi-ai includes minimal for adaptive reasoning models unless thinkingLevelMap.minimal === null.
      expect(options.some((option) => option.value === 'minimal')).toBe(true);
      expect(options.find((option) => option.value === 'minimal')?.label).toBe('Minimal');
    });

    it('returns only off for non-reasoning models', () => {
      expect(getPiThinkingLevelOptionsForModel(standardFixture())).toEqual([
        expect.objectContaining({ value: 'off' }),
      ]);
    });

    it('includes descriptions for supported thinking levels', () => {
      const highOption = getPiThinkingLevelOptionsForModel(reasoningFixture())
        .find((option) => option.value === 'high');
      expect(highOption?.description).toBe('Deep reasoning (~16k tokens)');
    });

    it('keeps upstream thinking-level order and labels model-specific maximum levels', () => {
      const options = getPiThinkingLevelOptionsForModel({
        ...reasoningFixture(),
        thinkingLevelMap: { xhigh: 'xhigh', max: 'max' },
      });

      expect(options.map((option) => option.value)).toEqual([
        'off',
        'minimal',
        'low',
        'medium',
        'high',
        'xhigh',
        'max',
      ]);
      expect(options.find((option) => option.value === 'xhigh')?.label).toBe('Xhigh');
      expect(options.find((option) => option.value === 'max')?.label).toBe('Max');
    });
  });

  describe('isPiAdaptiveReasoningModelValue', () => {
    it('is false when model is null', () => {
      expect(isPiAdaptiveReasoningModelValue(null)).toBe(false);
    });

    it('is true when reasoning models expose levels beyond off', () => {
      expect(isPiAdaptiveReasoningModelValue(reasoningFixture())).toBe(true);
    });

    it('is false for non-reasoning models', () => {
      expect(isPiAdaptiveReasoningModelValue(standardFixture())).toBe(false);
    });
  });

  describe('resolvePiThinkingLevelForModel', () => {
    it('returns off when model is null', () => {
      expect(resolvePiThinkingLevelForModel(null, 'high')).toBe('off');
    });

    it('preserves supported levels on reasoning models', () => {
      expect(resolvePiThinkingLevelForModel(reasoningFixture(), 'high')).toBe('high');
    });

    it('clamps unsupported levels on non-reasoning models to off', () => {
      expect(resolvePiThinkingLevelForModel(standardFixture(), 'high')).toBe('off');
    });

    it('clamps unknown level strings to a supported level on reasoning models', () => {
      const resolved = resolvePiThinkingLevelForModel(reasoningFixture(), 'bogus');
      const supported = getPiThinkingLevelOptionsForModel(reasoningFixture()).map((o) => o.value);
      expect(supported).toContain(resolved);
      expect(resolved).not.toBe('bogus');
    });
  });

  describe('getPiDefaultThinkingLevelForModel', () => {
    it('returns off when model is null', () => {
      expect(getPiDefaultThinkingLevelForModel(null)).toBe('off');
      expect(getPiDefaultThinkingLevelForModel(null, 'high')).toBe('off');
    });

    it('clamps invalid current values to model-supported levels', () => {
      const resolved = getPiDefaultThinkingLevelForModel(reasoningFixture(), 'bogus');
      const supported = getPiThinkingLevelOptionsForModel(reasoningFixture()).map((o) => o.value);
      expect(supported).toContain(resolved);
      expect(resolved).not.toBe('bogus');
    });
  });
});

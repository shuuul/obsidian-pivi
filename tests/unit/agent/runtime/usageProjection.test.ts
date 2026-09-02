import type { UsageInfo } from '@pivi/agent/runtime';
import {
  calculateCacheHitPercentage,
  calculateContextEnvelope,
  calculateCompactionRemainingTokens,
  calculateContextUsagePercentage,
  calculateReadToolMaxChars,
  calculateTokensPerSecond,
  calculateUsagePercentage,
  isContextOverLimit,
  MIN_GENERATION_ELAPSED_MS_FOR_TPS,
  preserveCacheActivity,
  READ_TOOL_MAX_CHARS_CAP,
  recalculateUsageForModel,
} from '@pivi/agent/runtime/usage';

const baseUsage: UsageInfo = {
  contextTokens: 980,
  contextWindow: 1000,
  inputTokens: 700,
  outputTokens: 40,
  outputTokenLimit: 200,
  percentage: 98,
};

describe('usage projection', () => {
  it('calculates context percentage from pressure against the compaction trigger', () => {
    const envelope = calculateContextEnvelope({
      contextWindow: 1000,
      contextWindowIsAuthoritative: true,
      providerContextTokens: 480,
    });
    const usage: UsageInfo = {
      contextEnvelope: envelope,
      contextTokens: 480,
      contextTokensIsAuthoritative: true,
      contextWindow: 1000,
      contextWindowIsAuthoritative: true,
      inputTokens: 480,
      outputTokens: 40,
      outputTokenLimit: 200,
      percentage: 48,
    };

    expect(calculateContextUsagePercentage(usage)).toBe(80);
    expect(calculateUsagePercentage(usage.contextTokens, usage.contextWindow)).toBe(48);
  });

  it('anchors pressure to authoritative provider context tokens', () => {
    const envelope = calculateContextEnvelope({
      contextWindow: 32_000,
      contextWindowIsAuthoritative: true,
      providerContextTokens: 20_000,
      recentConversation: 18_000,
      system: 4_000,
    });
    const usage: UsageInfo = {
      contextEnvelope: envelope,
      contextTokens: 12_000,
      contextTokensIsAuthoritative: true,
      contextWindow: 32_000,
      contextWindowIsAuthoritative: true,
      inputTokens: 12_000,
      outputTokens: 0,
      percentage: 38,
    };

    expect(envelope.pressureInputTokens).toBe(20_000);
    expect(calculateContextUsagePercentage(usage)).toBeGreaterThanOrEqual(80);
    expect(calculateUsagePercentage(usage.contextTokens, usage.contextWindow)).toBeLessThan(80);
  });

  it('uses the fallback window and context-token percentage after a model switch', () => {
    const next = recalculateUsageForModel(baseUsage, 'provider/model', 2000);
    expect(next).toMatchObject({
      model: 'provider/model',
      contextWindow: 2000,
      contextWindowIsAuthoritative: false,
      percentage: 49,
    });
  });

  it('preserves an authoritative window only for the same model', () => {
    const authoritative: UsageInfo = {
      ...baseUsage,
      model: 'provider/model',
      contextWindow: 4096,
      contextWindowIsAuthoritative: true,
    };
    expect(recalculateUsageForModel(authoritative, 'provider/model', 2000)).toMatchObject({
      contextWindow: 4096,
      contextWindowIsAuthoritative: true,
      percentage: 24,
    });
    expect(recalculateUsageForModel(authoritative, 'provider/other', 2000)).toMatchObject({
      contextWindow: 2000,
      contextWindowIsAuthoritative: false,
      percentage: 49,
    });
  });

  it('clears the previous model limit when the new model context length is unknown', () => {
    expect(recalculateUsageForModel(baseUsage, 'provider/unknown', null)).toMatchObject({
      contextWindow: 0,
      contextWindowIsAuthoritative: false,
      model: 'provider/unknown',
      percentage: 0,
    });
  });

  it('recalculates an existing context envelope when the model changes', () => {
    const previous = calculateContextEnvelope({
      contextWindow: 200_000,
      contextWindowIsAuthoritative: true,
      providerContextTokens: 50_000,
      recentConversation: 40_000,
      system: 10_000,
    });
    const next = recalculateUsageForModel({
      contextEnvelope: previous,
      contextTokens: 50_000,
      contextTokensIsAuthoritative: true,
      contextWindow: 200_000,
      contextWindowIsAuthoritative: true,
      inputTokens: 50_000,
      model: 'provider/old',
      outputTokenLimit: 16_000,
      percentage: 25,
    }, 'provider/new', 32_000);

    expect(next.outputTokenLimit).toBeUndefined();
    expect(next.contextEnvelope).toMatchObject({
      contextWindow: { source: 'estimated', tokens: 32_000 },
      compactionTriggerTokens: 19_200,
      pressureInputTokens: 50_000,
    });
  });

  it('keeps the fixed read ceiling near the compaction trigger', () => {
    const envelope = calculateContextEnvelope({
      contextWindow: 200_000,
      contextWindowIsAuthoritative: true,
      providerContextTokens: 175_000,
    });
    const usage: UsageInfo = {
      contextEnvelope: envelope,
      contextTokens: 175_000,
      contextTokensIsAuthoritative: true,
      contextWindow: 200_000,
      contextWindowIsAuthoritative: true,
      inputTokens: 175_000,
      percentage: 88,
    };

    expect(calculateCompactionRemainingTokens(usage)).toBe(0);
    expect(calculateReadToolMaxChars()).toBe(500_000);
  });

  it('calibrates the fixed read ceiling without exceeding its hard cap', () => {
    expect(calculateReadToolMaxChars(0.6)).toBe(300_000);
    expect(calculateReadToolMaxChars(1)).toBe(READ_TOOL_MAX_CHARS_CAP);
    expect(calculateReadToolMaxChars(1.5)).toBe(READ_TOOL_MAX_CHARS_CAP);
  });

  it('flags over-limit only when context tokens reach a known window', () => {
    expect(isContextOverLimit(null)).toBe(false);
    expect(isContextOverLimit(undefined)).toBe(false);
    expect(isContextOverLimit({ ...baseUsage, contextWindow: 0 })).toBe(false);
    expect(isContextOverLimit({ ...baseUsage, contextTokens: 999 })).toBe(false);
    expect(isContextOverLimit(baseUsage)).toBe(false);
    expect(isContextOverLimit({ ...baseUsage, contextTokens: 1000 })).toBe(true);
    expect(isContextOverLimit({ ...baseUsage, contextTokens: 147_000, contextWindow: 128_000 })).toBe(true);
  });

  it('does not let a full local estimate override provider-anchored pressure', () => {
    const contextEnvelope = calculateContextEnvelope({
      contextWindow: 1_000,
      providerContextTokens: 500,
      recentConversation: 700,
      system: 400,
    });

    expect(isContextOverLimit({
      ...baseUsage,
      contextEnvelope,
      contextTokens: 500,
    })).toBe(false);
  });

  it('returns 0% cache hit when the provider reported no cache activity', () => {
    expect(calculateCacheHitPercentage(baseUsage)).toBe(0);
    expect(calculateCacheHitPercentage({
      ...baseUsage,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
    })).toBe(0);
  });

  it('returns null cache hit when there is no prompt context yet', () => {
    expect(calculateCacheHitPercentage({
      ...baseUsage,
      contextTokens: 0,
      cacheReadInputTokens: 500,
    })).toBeNull();
  });

  it('shows 0% cache hit for a write-only first turn', () => {
    expect(calculateCacheHitPercentage({
      ...baseUsage,
      cacheCreationInputTokens: 200,
      cacheReadInputTokens: 0,
      contextTokens: 900,
      inputTokens: 700,
    })).toBe(0);
  });

  it('uses Pi-style cacheRead / contextTokens for latest-turn cache hit', () => {
    expect(calculateCacheHitPercentage({
      ...baseUsage,
      cacheCreationInputTokens: 100,
      cacheReadInputTokens: 500,
      contextTokens: 1000,
      inputTokens: 400,
    })).toBe(50);
  });

  it('returns null tokens/s when output or elapsed is too small', () => {
    expect(calculateTokensPerSecond(0, 1_000)).toBeNull();
    expect(calculateTokensPerSecond(40, MIN_GENERATION_ELAPSED_MS_FOR_TPS - 1)).toBeNull();
  });

  it('divides provider output tokens by generation seconds', () => {
    expect(calculateTokensPerSecond(80, 2_000)).toBe(40);
  });

  it('keeps last provider cache activity when a later usage omits cache fields', () => {
    expect(preserveCacheActivity({
      ...baseUsage,
      cacheCreationInputTokens: 100,
      cacheReadInputTokens: 500,
    }, {
      ...baseUsage,
      contextTokens: 1_200,
    })).toEqual({
      ...baseUsage,
      contextTokens: 1_200,
      cacheCreationInputTokens: 100,
      cacheReadInputTokens: 500,
    });
  });

  it('does not revive cache activity when the latest assistant reported none', () => {
    expect(preserveCacheActivity({
      ...baseUsage,
      cacheReadInputTokens: 500,
    }, {
      ...baseUsage,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
    })).toEqual({
      ...baseUsage,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
    });
  });
});

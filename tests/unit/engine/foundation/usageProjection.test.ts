import type { UsageInfo } from '@pivi/pivi-agent-core/foundation';
import {
  calculateContextEnvelope,
  calculateCompactionRemainingTokens,
  calculateContextUsagePercentage,
  calculateReadToolMaxChars,
  calculateUsagePercentage,
  READ_TOOL_MAX_CHARS_CAP,
  recalculateUsageForModel,
} from '@pivi/pivi-agent-core/foundation/usage';

const baseUsage: UsageInfo = {
  contextTokens: 980,
  contextWindow: 1000,
  inputTokens: 700,
  outputTokens: 40,
  outputTokenLimit: 200,
  percentage: 98,
};

describe('usage projection', () => {
  it('calculates context percentage from all provider-reported prompt context', () => {
    expect(calculateContextUsagePercentage(baseUsage)).toBe(98);
    expect(calculateUsagePercentage(baseUsage.contextTokens, baseUsage.contextWindow)).toBe(98);
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

  it('uses compaction headroom converted to characters when below the read cap', () => {
    const envelope = calculateContextEnvelope({
      contextWindow: 200_000,
      contextWindowIsAuthoritative: true,
      providerContextTokens: 157_000,
    });
    const usage: UsageInfo = {
      contextEnvelope: envelope,
      contextTokens: 157_000,
      contextTokensIsAuthoritative: true,
      contextWindow: 200_000,
      contextWindowIsAuthoritative: true,
      inputTokens: 157_000,
      percentage: 79,
    };

    expect(calculateCompactionRemainingTokens(usage)).toBe(7_000);
    expect(calculateReadToolMaxChars(usage)).toBe(28_000);
  });

  it('uses the read cap when compaction headroom exceeds it', () => {
    const envelope = calculateContextEnvelope({
      contextWindow: 200_000,
      contextWindowIsAuthoritative: true,
      providerContextTokens: 10_000,
    });
    const usage: UsageInfo = {
      contextEnvelope: envelope,
      contextTokens: 10_000,
      contextTokensIsAuthoritative: true,
      contextWindow: 200_000,
      contextWindowIsAuthoritative: true,
      inputTokens: 10_000,
      percentage: 5,
    };

    expect(calculateReadToolMaxChars(usage)).toBe(READ_TOOL_MAX_CHARS_CAP);
  });

  it('returns zero read max chars when compaction pressure is already at the trigger', () => {
    const envelope = calculateContextEnvelope({
      contextWindow: 200_000,
      contextWindowIsAuthoritative: true,
      providerContextTokens: 164_000,
    });
    const usage: UsageInfo = {
      contextEnvelope: envelope,
      contextTokens: 164_000,
      contextTokensIsAuthoritative: true,
      contextWindow: 200_000,
      contextWindowIsAuthoritative: true,
      inputTokens: 164_000,
      percentage: 82,
    };

    expect(calculateReadToolMaxChars(usage)).toBe(0);
  });

  it('falls back to the read cap when usage is unavailable', () => {
    expect(calculateReadToolMaxChars(null)).toBe(READ_TOOL_MAX_CHARS_CAP);
  });
});

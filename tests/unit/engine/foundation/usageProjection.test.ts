import type { UsageInfo } from '@pivi/pivi-agent-core/foundation';
import {
  calculateInputUsagePercentage,
  calculateUsagePercentage,
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
  it('calculates input-ring percentage from input tokens', () => {
    expect(calculateInputUsagePercentage(baseUsage)).toBe(70);
    expect(calculateUsagePercentage(baseUsage.contextTokens, baseUsage.contextWindow)).toBe(98);
  });

  it('uses the fallback window and input-token percentage after a model switch', () => {
    const next = recalculateUsageForModel(baseUsage, 'provider/model', 2000);
    expect(next).toMatchObject({
      model: 'provider/model',
      contextWindow: 2000,
      contextWindowIsAuthoritative: false,
      percentage: 35,
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
      percentage: 17,
    });
    expect(recalculateUsageForModel(authoritative, 'provider/other', 2000)).toMatchObject({
      contextWindow: 2000,
      contextWindowIsAuthoritative: false,
      percentage: 35,
    });
  });
});

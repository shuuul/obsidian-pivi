import {
  calculateInputUsagePercentage,
  calculateUsagePercentage,
  formatCompactTokenCount,
  recalculateUsageForModel,
} from '@pivi/obsidian-ui';
import type { UsageInfo } from '@pivi/pivi-agent-core/foundation';

describe('usageInfo helpers', () => {
  const baseUsage: UsageInfo = {
    contextTokens: 980,
    contextWindow: 1000,
    inputTokens: 700,
    outputTokens: 40,
    outputTokenLimit: 200,
    percentage: 98,
  };

  it('calculates input-ring percentage from inputTokens, not contextTokens', () => {
    expect(calculateInputUsagePercentage(baseUsage)).toBe(70);
    expect(calculateUsagePercentage(baseUsage.contextTokens, baseUsage.contextWindow)).toBe(98);
  });

  it('recalculates model window percentage from inputTokens', () => {
    const next = recalculateUsageForModel(baseUsage, 'provider/model', 2000);
    expect(next.model).toBe('provider/model');
    expect(next.contextWindow).toBe(2000);
    expect(next.percentage).toBe(35);
  });

  it('formats compact lowercase token counts for meter labels', () => {
    expect(formatCompactTokenCount(0)).toBe('0');
    expect(formatCompactTokenCount(900)).toBe('900');
    expect(formatCompactTokenCount(1_000)).toBe('1k');
    expect(formatCompactTokenCount(1_200)).toBe('1k');
    expect(formatCompactTokenCount(12_345)).toBe('12k');
    expect(formatCompactTokenCount(1_000_000)).toBe('1m');
    expect(formatCompactTokenCount(3_400_000)).toBe('3.4m');
    expect(formatCompactTokenCount(-1_500)).toBe('-2k');
    expect(formatCompactTokenCount(Number.NaN)).toBe('0');
  });
});

import { formatCompactTokenCount } from '../../packages/pivi-react/src/usage/usageInfo';

describe('usageInfo helpers', () => {
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

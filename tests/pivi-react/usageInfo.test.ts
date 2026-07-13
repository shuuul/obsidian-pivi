import { formatCompactTokenCount } from '../../packages/pivi-react/src/usage/usageInfo';

describe('usageInfo helpers', () => {
  it('formats compact token counts with uppercase units for meter labels', () => {
    expect(formatCompactTokenCount(0)).toBe('0');
    expect(formatCompactTokenCount(900)).toBe('900');
    expect(formatCompactTokenCount(1_000)).toBe('1K');
    expect(formatCompactTokenCount(1_200)).toBe('1K');
    expect(formatCompactTokenCount(12_345)).toBe('12K');
    expect(formatCompactTokenCount(1_000_000)).toBe('1M');
    expect(formatCompactTokenCount(3_400_000)).toBe('3.4M');
    expect(formatCompactTokenCount(-1_500)).toBe('-2K');
    expect(formatCompactTokenCount(Number.NaN)).toBe('0');
  });
});

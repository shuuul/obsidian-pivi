import {
  formatLeafLabel,
  formatSessionBranchCount,
} from '../../../../src/features/chat/controllers/SessionController';

describe('session history formatters', () => {
  it('formats branch counts only when multiple leaves are available', () => {
    expect(formatSessionBranchCount()).toBeNull();
    expect(formatSessionBranchCount(0)).toBeNull();
    expect(formatSessionBranchCount(1)).toBeNull();
    expect(formatSessionBranchCount(2)).toBe('2 branches');
  });

  it('prefers stored leaf labels', () => {
    expect(formatLeafLabel({ leafId: 'abcdef1234567890', label: 'Main path' }, 0)).toBe('Main path');
  });

  it('falls back to an indexed short leaf id', () => {
    expect(formatLeafLabel({ leafId: 'abcdef1234567890' }, 2)).toBe('Branch 3 · abcdef1');
  });
});

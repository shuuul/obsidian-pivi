import {
  formatLeafMeta,
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

  it('formats leaf metadata with durable leaf id and branch depth', () => {
    expect(formatLeafMeta(
      {
        leafId: 'abcdef1234567890',
        updatedAt: 123,
        messageCount: 4,
        depth: 7,
      },
      () => 'Jun 24',
    )).toBe('Jun 24 · Leaf abcdef1 · 4 messages · 7 steps deep');
  });
});

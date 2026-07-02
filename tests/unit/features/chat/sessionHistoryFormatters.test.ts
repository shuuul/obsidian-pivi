import {
  formatLeafMeta,
  formatLeafLabel,
  formatSessionBranchCount,
} from '@/ui/chat/controllers/SessionController';

describe('session history formatters', () => {
  it('formats branch counts only when multiple leaves are available', () => {
    expect(formatSessionBranchCount()).toBeNull();
    expect(formatSessionBranchCount(0)).toBeNull();
    expect(formatSessionBranchCount(1)).toBeNull();
    expect(formatSessionBranchCount(2)).toBe('2 states');
  });

  it('uses the session state content preview as the label', () => {
    expect(formatLeafLabel({ messagePreview: 'Summarized the current note' }, 0)).toBe('Summarized the current note');
  });

  it('falls back when a session state has no content preview', () => {
    expect(formatLeafLabel({}, 2)).toBe('Session state');
  });

  it('formats leaf metadata as human turn count only', () => {
    expect(formatLeafMeta(
      {
        messageCount: 4,
        turnCount: 3,
      },
      () => 'Jun 24',
    )).toBe('3 turns');
  });
});

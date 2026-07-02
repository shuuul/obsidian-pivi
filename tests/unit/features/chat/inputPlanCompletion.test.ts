import { resolvePlanCompletionFollowUp } from '@/ui/chat/composer/ComposerPlanFollowUp';

function createOptions(overrides: Partial<Parameters<typeof resolvePlanCompletionFollowUp>[0]> = {}) {
  return {
    planCompleted: true,
    didCancelThisTurn: false,
    streamGeneration: 3,
    getCurrentStreamGeneration: jest.fn(() => 3),
    showPlanApproval: jest.fn(async () => ({ decision: null, invalidated: false })),
    restorePrePlanPermissionModeIfNeeded: jest.fn(),
    setInputValue: jest.fn(),
    ...overrides,
  };
}

describe('resolvePlanCompletionFollowUp', () => {
  it('does nothing when no completed plan needs approval', async () => {
    const options = createOptions({ planCompleted: false });

    const result = await resolvePlanCompletionFollowUp(options);

    expect(result).toEqual({
      invalidated: false,
      autoSendContent: null,
      shouldProcessQueuedMessage: true,
    });
    expect(options.showPlanApproval).not.toHaveBeenCalled();
  });

  it('auto-sends implementation and restores permission mode for implement decisions', async () => {
    const options = createOptions({
      showPlanApproval: jest.fn(async () => ({
        decision: { type: 'implement' as const },
        invalidated: false,
      })),
    });

    const result = await resolvePlanCompletionFollowUp(options);

    expect(result).toEqual({
      invalidated: false,
      autoSendContent: 'Implement the plan.',
      shouldProcessQueuedMessage: true,
    });
    expect(options.restorePrePlanPermissionModeIfNeeded).toHaveBeenCalled();
  });

  it('keeps plan mode active and suppresses queued messages for revise decisions', async () => {
    const options = createOptions({
      showPlanApproval: jest.fn(async () => ({
        decision: { type: 'revise' as const, text: 'Adjust scope' },
        invalidated: false,
      })),
    });

    const result = await resolvePlanCompletionFollowUp(options);

    expect(result).toEqual({
      invalidated: false,
      autoSendContent: null,
      shouldProcessQueuedMessage: false,
    });
    expect(options.setInputValue).toHaveBeenCalledWith('Adjust scope');
    expect(options.restorePrePlanPermissionModeIfNeeded).not.toHaveBeenCalled();
  });

  it('marks async approval results invalid when stream generation changes', async () => {
    const options = createOptions({
      getCurrentStreamGeneration: jest.fn(() => 4),
      showPlanApproval: jest.fn(async () => ({
        decision: { type: 'implement' as const },
        invalidated: false,
      })),
    });

    const result = await resolvePlanCompletionFollowUp(options);

    expect(result.invalidated).toBe(true);
    expect(options.restorePrePlanPermissionModeIfNeeded).not.toHaveBeenCalled();
  });
});

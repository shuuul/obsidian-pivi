import type { PlanApprovalResult } from './ComposerApprovals';

export interface ResolvePlanCompletionFollowUpOptions {
  planCompleted: boolean;
  didCancelThisTurn: boolean;
  streamGeneration: number;
  getCurrentStreamGeneration: () => number;
  showPlanApproval: () => Promise<PlanApprovalResult>;
  restorePrePlanPermissionModeIfNeeded: () => void;
  setInputValue: (value: string) => void;
}

export interface PlanCompletionFollowUp {
  invalidated: boolean;
  autoSendContent: string | null;
  shouldProcessQueuedMessage: boolean;
}

export async function resolvePlanCompletionFollowUp(
  options: ResolvePlanCompletionFollowUpOptions,
): Promise<PlanCompletionFollowUp> {
  if (!options.planCompleted || options.didCancelThisTurn) {
    return {
      invalidated: false,
      autoSendContent: null,
      shouldProcessQueuedMessage: true,
    };
  }

  const { decision, invalidated } = await options.showPlanApproval();
  if (options.getCurrentStreamGeneration() !== options.streamGeneration || invalidated) {
    return {
      invalidated: true,
      autoSendContent: null,
      shouldProcessQueuedMessage: true,
    };
  }

  if (decision?.type === 'implement') {
    options.restorePrePlanPermissionModeIfNeeded();
    return {
      invalidated: false,
      autoSendContent: 'Implement the plan.',
      shouldProcessQueuedMessage: true,
    };
  }

  if (decision?.type === 'revise') {
    options.setInputValue(decision.text);
    return {
      invalidated: false,
      autoSendContent: null,
      shouldProcessQueuedMessage: false,
    };
  }

  options.restorePrePlanPermissionModeIfNeeded();
  return {
    invalidated: false,
    autoSendContent: null,
    shouldProcessQueuedMessage: true,
  };
}

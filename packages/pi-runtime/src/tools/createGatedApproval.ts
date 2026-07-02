import type { ApprovalDecision } from '@pivi/core/settings';
import type { ObsidianApprovalFn } from '@pivi/obsidian-tools';
import type { SessionApprovalRules } from '@pivi/tools';

import type { ApprovalCallback } from '../types';

export function createGatedApproval(
  callback: ApprovalCallback | null,
  rules: SessionApprovalRules,
  resolvePattern: (toolName: string, input: Record<string, unknown>) => string | null,
): ObsidianApprovalFn | null {
  if (!callback) {
    return null;
  }

  return async (
    toolName: string,
    input: Record<string, unknown>,
    description: string,
  ): Promise<ApprovalDecision> => {
    const pattern = resolvePattern(toolName, input);

    if (pattern !== null && rules.matches(toolName, pattern)) {
      return 'allow';
    }

    const decision = await callback(toolName, input, description);

    if (decision === 'allow-always') {
      rules.recordAlwaysAllow(toolName, input, pattern);
    }

    return decision;
  };
}
import type { ApprovalDecision } from '@pivi/pivi-agent-core/foundation/settings';
import type { SessionApprovalRules } from '@pivi/pivi-agent-core/tools';

import type { ApprovalCallback } from '../../runtime/types';

export type ToolApprovalFn = (
  toolName: string,
  input: Record<string, unknown>,
  description: string,
) => Promise<ApprovalDecision>;

export function createGatedApproval(
  callback: ApprovalCallback | null,
  rules: SessionApprovalRules,
  resolvePattern: (toolName: string, input: Record<string, unknown>) => string | null,
): ToolApprovalFn | null {
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

import { getActionDescription } from '../../../core/security/ApprovalManager';
import { isObsidianMutatingTool } from '../../../core/tools/obsidianToolNames';
import type { ApprovalDecision } from '../../../core/types/settings';

export type ObsidianApprovalFn = (
  toolName: string,
  input: Record<string, unknown>,
  description: string,
) => Promise<ApprovalDecision>;

export async function requireApproval(
  approve: ObsidianApprovalFn | null,
  toolName: string,
  input: Record<string, unknown>,
): Promise<void> {
  if (!approve || !isObsidianMutatingTool(toolName)) {
    return;
  }
  const description = getActionDescription(toolName, input);
  const decision = await approve(toolName, input, description);
  if (decision === 'deny' || decision === 'cancel') {
    throw new Error(`User denied: ${toolName}`);
  }
}

import type { BashClassification } from '../tools/capabilityPermissions';
import type { PersistentBashPermission } from '../tools/capabilityPermissions';

/** Capability kinds that may show sidebar inline approval in Pivi. */
export type CapabilityApprovalKind = 'bash' | 'external-directory';

export type CapabilityApprovalDecision =
  | 'deny'
  | 'allow-once'
  | 'allow-always'
  | 'cancel';

export interface CapabilityApprovalResult {
  decision: CapabilityApprovalDecision;
  bashPermissions?: PersistentBashPermission[];
}

export interface CapabilityApprovalRequest {
  kind: CapabilityApprovalKind;
  toolName: string;
  /** Normalized bash command string for matching. */
  command?: string;
  /** Exact shell executable resolved before Bash authorization. */
  shellPath?: string;
  /** Classifier result used to render persistable scopes. */
  bashClassification?: BashClassification;
  /** Blocked absolute path shown in the prompt. */
  blockedPath?: string;
  /** Directory root to grant for external access (directory itself or parent of a file). */
  directoryRoot?: string;
  reason: string;
  description: string;
}

/** Host-neutral port for sidebar capability confirmations. */
export interface CapabilityApprovalPort {
  hasPersistentGrant(request: CapabilityApprovalRequest): boolean;
  requestApproval(request: CapabilityApprovalRequest): Promise<CapabilityApprovalResult>;
}

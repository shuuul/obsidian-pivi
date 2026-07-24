/** Capability kinds that may show sidebar inline approval in Pivi. */
export type CapabilityApprovalKind = 'bash' | 'external-directory';

export type CapabilityApprovalDecision =
  | 'deny'
  | 'allow'
  | 'allow-session'
  | 'allow-always'
  | 'cancel';

/** How an always-allowed bash entry is written to settings. */
export type BashAllowlistPersistScope = 'full' | 'prefix';

export interface CapabilityApprovalResult {
  decision: CapabilityApprovalDecision;
  bashAllowlistScope?: BashAllowlistPersistScope;
}

export interface CapabilityApprovalRequest {
  kind: CapabilityApprovalKind;
  toolName: string;
  /** Normalized bash command string for allowlist/session matching. */
  command?: string;
  /** Blocked absolute path shown in the prompt. */
  blockedPath?: string;
  /** Directory root to grant for external access (directory itself or parent of a file). */
  directoryRoot?: string;
  reason: string;
  description: string;
}

/** Host-neutral port for sidebar capability confirmations. */
export interface CapabilityApprovalPort {
  hasSessionGrant(request: CapabilityApprovalRequest): boolean;
  requestApproval(request: CapabilityApprovalRequest): Promise<CapabilityApprovalResult>;
  clearSessionGrants(): void;
}

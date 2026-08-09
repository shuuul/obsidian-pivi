/** Pivi-owned, normalized value that is safe to show in a management plan. */
export type PiviManagementPlanValue = string | number | boolean | null;

export interface PiviManagementPlanField {
  label: string;
  value: PiviManagementPlanValue | readonly PiviManagementPlanValue[];
}

/** Immutable preview produced by a Pivi coordinator, never by Agent prose. */
export interface PiviManagementApprovalRequest {
  domain: 'mcp' | 'skills' | 'commands';
  action: string;
  title: string;
  revision: string | number;
  changeLines?: readonly string[];
  fields?: readonly PiviManagementPlanField[];
}

export type PiviManagementApprovalDecision = 'confirm' | 'deny' | 'cancel';

/** Dedicated one-shot confirmation port. It intentionally has no grant APIs. */
export interface PiviManagementApprovalPort {
  requestApproval(
    request: PiviManagementApprovalRequest,
    signal?: AbortSignal,
  ): Promise<PiviManagementApprovalDecision>;
}

export type PiviManagementErrorCode =
  | 'state_changed'
  | 'denied'
  | 'cancelled'
  | 'unavailable'
  | 'persistence_failed'
  | 'refresh_failed'
  | 'validation_failed';

export class PiviManagementError extends Error {
  readonly name = 'PiviManagementError';

  constructor(
    readonly code: PiviManagementErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

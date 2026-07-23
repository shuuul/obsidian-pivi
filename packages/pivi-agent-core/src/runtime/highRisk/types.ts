/**
 * Fixed high-risk operation kinds, budgets, and resource fingerprinting.
 * Authorization is turn-scoped; grants never outlive the owning turn/session.
 */

export const HIGH_RISK_BULK_CHILD_THRESHOLD = 10;

/** User must respond within this window or the request fails closed. */
export const HIGH_RISK_APPROVAL_TIMEOUT_MS = 120_000;

/** Bounded diagnostics audit retention. */
export const HIGH_RISK_AUDIT_MAX_RECORDS = 200;
export const HIGH_RISK_AUDIT_MAX_BYTES = 256 * 1024;

/** MCP tool-result budgets enforced before model context / session persistence. */
export const MCP_RESULT_MAX_BLOCKS = 32;
export const MCP_RESULT_MAX_ENCODED_BYTES = 256 * 1024;
export const MCP_RESULT_MAX_TEXT_CHARS = 100_000;
export const MCP_RESULT_MAX_JSON_DEPTH = 32;
export const MCP_RESULT_MAX_RESOURCES = 8;

/** Skills staged-tree publication limits. */
export const SKILLS_STAGE_MAX_FILES = 200;
export const SKILLS_STAGE_MAX_FILE_BYTES = 512 * 1024;
export const SKILLS_STAGE_MAX_TOTAL_BYTES = 2 * 1024 * 1024;
export const SKILLS_STAGE_MAX_SKILL_MD_BYTES = 64 * 1024;

export const PINNED_SKILLS_CLI_PACKAGE = 'skills';
export const PINNED_SKILLS_CLI_VERSION = '1.5.20';

export type HighRiskOperationKind =
  | 'delete'
  | 'overwrite'
  | 'bulk-mutation'
  | 'bash'
  | 'eval'
  | 'stdio-mcp-launch'
  | 'mcp-artifact-write';

/**
 * Redacted preview payload shown to the user and used for grant fingerprinting.
 * Never include document bodies, secret values, headers, env values, or auth codes.
 */
export interface HighRiskResourceSummary {
  paths?: readonly string[];
  executable?: string;
  args?: readonly string[];
  cwd?: string;
  envVarNames?: readonly string[];
  mcpServer?: string;
  mcpTool?: string;
  origin?: string;
  bulkCount?: number;
}

export interface HighRiskOperationRequest {
  kind: HighRiskOperationKind;
  sessionId: string;
  turnId: string;
  resources: HighRiskResourceSummary;
  /** Optional tool name for audit/diagnostics only. */
  toolName?: string;
}

export type HighRiskApprovalOutcome =
  | 'approved'
  | 'denied'
  | 'cancelled'
  | 'timeout'
  | 'invalidated'
  | 'subagent-denied';

export interface HighRiskApprovalResult {
  outcome: HighRiskApprovalOutcome;
  grantKey?: string;
}

export interface HighRiskGrant {
  key: string;
  kind: HighRiskOperationKind;
  sessionId: string;
  turnId: string;
  resourceFingerprint: string;
  grantedAt: number;
}

export interface HighRiskAuditEntry {
  at: number;
  kind: HighRiskOperationKind;
  outcome: HighRiskApprovalOutcome;
  sessionId: string;
  turnId: string;
  resourceFingerprint: string;
  toolName?: string;
  /** Execution outcome after approval; omitted when never executed. */
  execution?: 'completed' | 'failed' | 'skipped';
}

export type HighRiskControllerMode = 'interactive' | 'inherit-only';

export interface HighRiskApprovalPresenter {
  present(request: HighRiskOperationRequest): Promise<'approve' | 'deny' | 'cancel'>;
}

export interface HighRiskAuditSink {
  record(entry: HighRiskAuditEntry): void;
}

export function normalizeResourceSummary(
  resources: HighRiskResourceSummary,
): HighRiskResourceSummary {
  const normalized: HighRiskResourceSummary = {};
  if (resources.paths && resources.paths.length > 0) {
    normalized.paths = [...resources.paths]
      .map((path) => path.trim().replace(/\\/g, '/'))
      .filter(Boolean)
      .sort();
  }
  if (resources.executable) {
    normalized.executable = resources.executable.trim();
  }
  if (resources.args && resources.args.length > 0) {
    normalized.args = [...resources.args];
  }
  if (resources.cwd) {
    normalized.cwd = resources.cwd.trim().replace(/\\/g, '/');
  }
  if (resources.envVarNames && resources.envVarNames.length > 0) {
    normalized.envVarNames = [...resources.envVarNames]
      .map((name) => name.trim())
      .filter(Boolean)
      .sort();
  }
  if (resources.mcpServer) {
    normalized.mcpServer = resources.mcpServer.trim();
  }
  if (resources.mcpTool) {
    normalized.mcpTool = resources.mcpTool.trim();
  }
  if (resources.origin) {
    normalized.origin = resources.origin.trim().toLowerCase();
  }
  if (typeof resources.bulkCount === 'number' && Number.isFinite(resources.bulkCount)) {
    normalized.bulkCount = Math.max(0, Math.floor(resources.bulkCount));
  }
  return normalized;
}

export function fingerprintResources(resources: HighRiskResourceSummary): string {
  return JSON.stringify(normalizeResourceSummary(resources));
}

export function buildHighRiskGrantKey(
  sessionId: string,
  turnId: string,
  kind: HighRiskOperationKind,
  resources: HighRiskResourceSummary,
): string {
  return [
    sessionId,
    turnId,
    kind,
    fingerprintResources(resources),
  ].join('\u001f');
}

export function isGrantNarrowerOrEqual(
  parent: HighRiskResourceSummary,
  child: HighRiskResourceSummary,
): boolean {
  const parentNorm = normalizeResourceSummary(parent);
  const childNorm = normalizeResourceSummary(child);

  if (childNorm.executable && childNorm.executable !== parentNorm.executable) {
    return false;
  }
  if (childNorm.args) {
    if (!parentNorm.args || parentNorm.args.length !== childNorm.args.length) {
      return false;
    }
    for (let i = 0; i < childNorm.args.length; i += 1) {
      if (childNorm.args[i] !== parentNorm.args[i]) {
        return false;
      }
    }
  }
  if (childNorm.cwd && childNorm.cwd !== parentNorm.cwd) {
    return false;
  }
  if (childNorm.mcpServer && childNorm.mcpServer !== parentNorm.mcpServer) {
    return false;
  }
  if (childNorm.mcpTool && childNorm.mcpTool !== parentNorm.mcpTool) {
    return false;
  }
  if (childNorm.origin && childNorm.origin !== parentNorm.origin) {
    return false;
  }
  if (childNorm.paths) {
    const parentPaths = new Set(parentNorm.paths ?? []);
    if (parentPaths.size === 0) {
      return false;
    }
    for (const path of childNorm.paths) {
      if (!parentPaths.has(path)) {
        return false;
      }
    }
  }
  if (
    typeof childNorm.bulkCount === 'number'
    && typeof parentNorm.bulkCount === 'number'
    && childNorm.bulkCount > parentNorm.bulkCount
  ) {
    return false;
  }
  if (childNorm.envVarNames) {
    const parentEnv = new Set(parentNorm.envVarNames ?? []);
    for (const name of childNorm.envVarNames) {
      if (!parentEnv.has(name)) {
        return false;
      }
    }
  }
  return true;
}

export class HighRiskDeniedError extends Error {
  readonly code = 'high-risk-denied' as const;
  readonly outcome: HighRiskApprovalOutcome;

  constructor(outcome: HighRiskApprovalOutcome, message?: string) {
    super(message ?? `High-risk operation ${outcome}`);
    this.name = 'HighRiskDeniedError';
    this.outcome = outcome;
  }
}

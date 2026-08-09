/**
 * Agent-safe DTOs for pivi_mcp / pivi_skills / pivi_commands (spec 040).
 * Raw secrets never appear in model-visible arguments or sanitized projections.
 */

/** Common mutation result returned after plan/confirm/commit/refresh. */
export interface PiviManagementMutationResult<T> {
  saved: boolean;
  refreshed: boolean;
  effective?: T;
  warnings?: string[];
  refreshFailures?: Array<{ target: string; message: string }>;
}

// ---------------------------------------------------------------------------
// MCP — secret projections and input actions
// ---------------------------------------------------------------------------

/** Agent-visible value reference: no raw secret material. */
export type AgentMcpValueInput =
  | { source: 'plain'; value: string }
  | { source: 'systemEnvironment'; variable: string }
  | { source: 'clear' };

/**
 * Bearer token input for Agent upsert.
 * New keychain secrets cannot be supplied here; omit preserves, clear removes,
 * systemEnvironment references a host env name.
 */
export type AgentMcpBearerInput =
  | { source: 'systemEnvironment'; variable: string }
  | { source: 'clear' };

/** OAuth client settings without client secrets. */
export interface AgentMcpOAuthInput {
  grantType?: 'authorization_code' | 'client_credentials';
  clientId?: string;
  scope?: string;
  /** Explicitly clear a previously stored OAuth client secret. */
  clearClientSecret?: boolean;
}

export interface AgentMcpRemoteServerInput {
  type: 'http' | 'sse';
  url: string;
  headers?: Record<string, AgentMcpValueInput>;
  enabled?: boolean;
  contextSaving?: boolean;
  disabledTools?: string[];
  description?: string;
  auth?: 'none' | 'bearer' | 'oauth';
  oauth?: AgentMcpOAuthInput | false;
  bearerToken?: AgentMcpBearerInput;
}

export interface AgentMcpStdioServerInput {
  type?: 'stdio';
  command: string;
  args?: string[];
  env?: Record<string, AgentMcpValueInput>;
  enabled?: boolean;
  contextSaving?: boolean;
  disabledTools?: string[];
  description?: string;
}

export type AgentMcpServerInput = AgentMcpRemoteServerInput | AgentMcpStdioServerInput;

export type PiviMcpInput =
  | { action: 'list' }
  | { action: 'test'; name: string }
  | { action: 'upsert'; name: string; server: AgentMcpServerInput }
  | { action: 'set_enabled'; name: string; enabled: boolean }
  | { action: 'remove'; name: string };

/** Sanitized secret metadata exposed in list/effective projections. */
export type AgentMcpSecretProjection =
  | { source: 'secret'; configured: boolean }
  | { source: 'systemEnvironment'; variable: string }
  | { source: 'plain'; value: string }
  | { source: 'none' };

export interface AgentMcpToolInventoryEntry {
  name: string;
  description?: string;
}

export interface AgentMcpServerSummary {
  name: string;
  type: 'stdio' | 'http' | 'sse';
  enabled: boolean;
  contextSaving: boolean;
  description?: string;
  disabledTools?: string[];
  url?: string;
  command?: string;
  args?: string[];
  auth?: 'none' | 'bearer' | 'oauth';
  /** Header names with source/configured metadata only. */
  headers?: Record<string, AgentMcpSecretProjection>;
  /** Env names with source/configured metadata only. */
  env?: Record<string, AgentMcpSecretProjection>;
  bearerToken?: AgentMcpSecretProjection;
  oauth?: {
    grantType?: 'authorization_code' | 'client_credentials';
    clientId?: string;
    scope?: string;
    clientSecret?: { source: 'secret'; configured: boolean } | { source: 'none' };
  } | false;
  /** Cache-only tool names; list must not connect. */
  tools?: AgentMcpToolInventoryEntry[];
}

export interface PiviMcpListResult {
  servers: AgentMcpServerSummary[];
}

export interface PiviMcpTestResult {
  name: string;
  success: boolean;
  authenticationRequired?: boolean;
  serverVersion?: string;
  tools?: AgentMcpToolInventoryEntry[];
  error?: string;
}

// ---------------------------------------------------------------------------
// Skills
// ---------------------------------------------------------------------------

export type PiviSkillsInput =
  | { action: 'list' }
  | { action: 'list_remote'; source: string }
  | { action: 'install'; source: string; skillNames?: string[] }
  | { action: 'set_enabled'; name: string; enabled: boolean }
  | { action: 'update'; name: string }
  | { action: 'update_all' }
  | { action: 'remove'; name: string };

export interface AgentSkillSummary {
  name: string;
  description?: string;
  folderName?: string;
  /** Positive Agent-facing enabled state. */
  enabled: boolean;
  packageSource?: string;
}

export interface AgentRemoteSkillEntry {
  name: string;
  description?: string;
}

export interface PiviSkillsListResult {
  skills: AgentSkillSummary[];
}

export interface PiviSkillsListRemoteResult {
  source: string;
  skills: AgentRemoteSkillEntry[];
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

export type PiviCommandsInput =
  | { action: 'list' }
  | { action: 'get'; id: string }
  | {
      action: 'upsert';
      id: string;
      name?: string;
      description?: string;
      argumentHint?: string;
      icon?: string;
      content: string;
      catalogRevision: number;
    }
  | { action: 'remove'; id: string; catalogRevision: number }
  | {
      action: 'move';
      id: string;
      beforeId?: string;
      afterId?: string;
      catalogRevision: number;
    };

/** List metadata without prompt bodies. */
export interface AgentCommandSummary {
  id: string;
  name: string;
  description?: string;
  argumentHint?: string;
  icon?: string;
  scope?: string;
  source?: string;
  isEditable?: boolean;
  isDeletable?: boolean;
}

export interface AgentCommandDetail extends AgentCommandSummary {
  content: string;
}

export interface PiviCommandsListResult {
  commands: AgentCommandSummary[];
  catalogRevision: number;
}

export interface PiviCommandsGetResult {
  command: AgentCommandDetail;
  catalogRevision: number;
}

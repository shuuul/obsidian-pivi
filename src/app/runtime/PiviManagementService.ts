import type { McpManagementCoordinator } from "@pivi/agent/mcp/mcpManagementCoordinator";
import type {
  SkillsManagementCoordinator,
} from "@pivi/agent/skills/vault/skillsManagementCoordinator";
import {
  createPiviCommandsTool,
  createPiviMcpTool,
  createPiviPromptTool,
  createPiviSkillsTool,
  type PiviCommandsInput,
  type PiviManagementApprovalPort,
  type PiviManagementApprovalRequest,
  type PiviManagementDomain,
  PiviManagementError,
  type PiviManagementMutationResult,
  type PiviManagementPlanField,
  type PiviManagementPlanValue,
  type PiviManagementPort,
  type PiviMcpInput,
  type PiviPromptInput,
  type PiviSkillsInput,
} from "@pivi/agent/tools/piviManagement";
import type { PiMainOnlyToolProvider } from "@pivi/engine-pi/application/runtime";

import { t } from "../i18n";
import {
  presentCommandsManagementApproval,
  presentMcpManagementApproval,
  presentPromptManagementApproval,
  presentSkillsManagementApproval,
} from "../piviManagementApprovalPresentation";
import {
  type PiSlashCommandCatalog,
  PiviCommandsManagementError,
} from "./PiSlashCommandCatalog";
import type { PromptCompositionCoordinator } from "./PromptCompositionCoordinator";

export type { PiviManagementDomain } from "@pivi/agent/tools/piviManagement";

/** Bounded sanitized failure returned from a management refresh pass. */
export interface PiviManagementRefreshFailure {
  readonly target: string;
  readonly message: string;
}

/** Narrow same-turn refresh seam owned by the plugin host. */
export interface PiviManagementRefreshHost {
  refreshPiviManagement(
    domain: PiviManagementDomain,
  ): Promise<readonly PiviManagementRefreshFailure[]>;
}

const GENERIC_REFRESH_FAILURE_MESSAGE = "Runtime refresh failed.";
const MAX_REFRESH_FAILURES = 20;

export interface PiviManagementServiceDeps {
  mcp: McpManagementCoordinator;
  skills: SkillsManagementCoordinator;
  commands: PiSlashCommandCatalog;
  prompt: PromptCompositionCoordinator;
  refresh: PiviManagementRefreshHost;
}

const EMPTY_PROVIDER_SUMMARY = {
  obsidianTools: [] as string[],
  obsidianCliAvailable: false,
  includeMcp: false,
  includeSkill: false,
  includeSubagent: false,
  includeWebSearch: false,
};

/**
 * Per-chat management port: workspace-global coordinators + invoking-tab approval.
 * Queries never approve or write. Mutations are plan → one-shot approve → exact-revision commit → refresh.
 */
export function createPiviManagementPort(
  deps: PiviManagementServiceDeps,
  approval: PiviManagementApprovalPort | null,
): PiviManagementPort {
  return {
    executeMcp: (input, signal) => executeMcp(deps, approval, input, signal),
    executeSkills: (input, signal) => executeSkills(deps, approval, input, signal),
    executeCommands: (input, signal) => executeCommands(deps, approval, input, signal),
    executePrompt: (input, signal) => executePrompt(deps, approval, input, signal),
  };
}

/**
 * Factory that binds workspace coordinators once and produces a main-only provider
 * per chat from that chat's one-shot approval port.
 */
export function createPiviManagementMainOnlyToolProviderFactory(
  deps: PiviManagementServiceDeps,
  getDisabledTools: () => readonly string[] = () => [],
): (approval: PiviManagementApprovalPort | null) => PiMainOnlyToolProvider {
  return (approval) => {
    const port = createPiviManagementPort(deps, approval);
    return () => ({
      toolSpecs: [
        createPiviMcpTool(port),
        createPiviSkillsTool(port),
        createPiviCommandsTool(port),
        createPiviPromptTool(port),
      ].filter(tool => !getDisabledTools().includes(tool.name)),
      registeredToolSummary: EMPTY_PROVIDER_SUMMARY,
    });
  };
}

async function executeMcp(
  deps: PiviManagementServiceDeps,
  approval: PiviManagementApprovalPort | null,
  input: PiviMcpInput,
  signal?: AbortSignal,
): Promise<unknown> {
  if (input.action === "list") return deps.mcp.query();
  if (input.action === "test") return deps.mcp.test(input.name, signal);

  const plan = await deps.mcp.plan(input);
  await requireConfirm(approval, presentMcpManagementApproval(plan, t), signal);
  const committed = await deps.mcp.commit(plan, plan.revision, signal);
  const result: PiviManagementMutationResult<unknown> = {
    saved: true,
    refreshed: committed.refreshed,
    ...(committed.effective
      ? { effective: committed.effective }
      : committed.removedName !== undefined
        ? { effective: { name: committed.removedName, removed: true } }
        : {}),
    ...(committed.warnings ? { warnings: [...committed.warnings] } : {}),
    ...(committed.refreshFailures
      ? { refreshFailures: committed.refreshFailures.map((entry) => ({ ...entry })) }
      : {}),
  };
  return finalizeMutation(deps, "mcp", result);
}

async function executeSkills(
  deps: PiviManagementServiceDeps,
  approval: PiviManagementApprovalPort | null,
  input: PiviSkillsInput,
  signal?: AbortSignal,
): Promise<unknown> {
  if (input.action === "list") {
    const { skills } = deps.skills.snapshot();
    return { skills };
  }
  if (input.action === "list_remote") {
    return deps.skills.listRemote(input.source, signal);
  }

  const plan = deps.skills.plan(input);
  await requireConfirm(approval, presentSkillsManagementApproval(plan, t), signal);
  const committed = await deps.skills.commit(plan, plan.revision, signal);
  return finalizeMutation(deps, "skills", {
    saved: true,
    refreshed: committed.refreshed,
    effective: { skills: committed.skills },
    ...(committed.warnings ? { warnings: [...committed.warnings] } : {}),
    ...(committed.refreshFailures
      ? { refreshFailures: committed.refreshFailures.map((entry) => ({ ...entry })) }
      : {}),
  });
}

async function executeCommands(
  deps: PiviManagementServiceDeps,
  approval: PiviManagementApprovalPort | null,
  input: PiviCommandsInput,
  signal?: AbortSignal,
): Promise<unknown> {
  if (input.action === "list" || input.action === "get") {
    try {
      return await deps.commands.executeCommands(input, signal);
    } catch (cause) {
      throw mapCommandsError(cause);
    }
  }

  let plan;
  try {
    plan = await deps.commands.planCommands(input, signal);
  } catch (cause) {
    throw mapCommandsError(cause);
  }
  await requireConfirm(approval, presentCommandsManagementApproval(plan, t), signal);
  let committed: unknown;
  try {
    committed = await deps.commands.commitCommands(plan, plan.revision, signal);
  } catch (cause) {
    throw mapCommandsError(cause);
  }
  const base = asMutationResult(committed);
  return finalizeMutation(deps, "commands", base);
}

async function executePrompt(
  deps: PiviManagementServiceDeps,
  approval: PiviManagementApprovalPort | null,
  input: PiviPromptInput,
  signal?: AbortSignal,
): Promise<unknown> {
  if (input.action === "list") {
    return deps.prompt.queryList();
  }
  if (input.action === "get") {
    try {
      return deps.prompt.queryGet(input.id);
    } catch (cause) {
      throw mapPromptError(cause);
    }
  }

  let plan;
  try {
    plan = deps.prompt.plan(input);
  } catch (cause) {
    throw mapPromptError(cause);
  }
  await requireConfirm(approval, presentPromptManagementApproval(plan, t), signal);
  let committed;
  try {
    committed = await deps.prompt.commit(plan, input.catalogRevision);
  } catch (cause) {
    throw mapPromptError(cause);
  }
  return finalizeMutation(deps, "prompt", committed);
}

async function requireConfirm(
  approval: PiviManagementApprovalPort | null,
  request: PiviManagementApprovalRequest,
  signal?: AbortSignal,
): Promise<void> {
  throwIfAborted(signal);
  if (!approval) {
    throw new PiviManagementError(
      "unavailable",
      "Pivi management confirmation is unavailable in this chat.",
    );
  }
  let decision: "confirm" | "deny" | "cancel";
  try {
    decision = await approval.requestApproval(freezeApprovalRequest(request), signal);
  } catch (cause) {
    if (isAbortError(cause) || signal?.aborted) {
      throw new PiviManagementError("cancelled", "Management confirmation was cancelled.", {
        cause: cause instanceof Error ? cause : undefined,
      });
    }
    throw new PiviManagementError(
      "unavailable",
      "Pivi management confirmation failed.",
      { cause: cause instanceof Error ? cause : undefined },
    );
  }
  throwIfAborted(signal);
  if (decision === "confirm") return;
  if (decision === "deny") {
    throw new PiviManagementError("denied", "User denied the management change.");
  }
  throw new PiviManagementError("cancelled", "Management confirmation was cancelled.");
}

async function finalizeMutation<T>(
  deps: PiviManagementServiceDeps,
  domain: PiviManagementDomain,
  result: PiviManagementMutationResult<T>,
): Promise<PiviManagementMutationResult<T>> {
  if (!result.saved) return result;
  // Sanitize coordinator failures at this app boundary before model-visible return.
  const failures: PiviManagementRefreshFailure[] = (result.refreshFailures ?? []).map((entry) =>
    sanitizeRefreshFailure(entry),
  );
  let refreshed = result.refreshed;
  try {
    const hostFailures = await deps.refresh.refreshPiviManagement(domain);
    for (const entry of hostFailures) {
      failures.push(sanitizeRefreshFailure(entry));
    }
    if (hostFailures.length > 0) refreshed = false;
  } catch (cause) {
    // Host should return failures rather than throw; keep a sanitized fallback.
    refreshed = false;
    failures.push({
      target: `views:${domain}`,
      message: GENERIC_REFRESH_FAILURE_MESSAGE,
    });
    void cause;
  }
  if (failures.length === 0 && refreshed) {
    return { ...result, refreshed: true };
  }
  return {
    ...result,
    refreshed: false,
    warnings: uniqueStrings([
      ...(result.warnings ?? []),
      "Configuration was saved, but some runtime refresh work failed.",
    ]),
    refreshFailures: failures.slice(0, MAX_REFRESH_FAILURES),
  };
}

function sanitizeRefreshFailure(
  entry: { target?: unknown; message?: unknown },
): PiviManagementRefreshFailure {
  const target = typeof entry.target === "string" && entry.target.trim()
    ? entry.target.trim().slice(0, 120)
    : "runtime";
  // Never forward raw underlying errors (may contain secrets/paths).
  return { target, message: GENERIC_REFRESH_FAILURE_MESSAGE };
}

function asMutationResult(value: unknown): PiviManagementMutationResult<unknown> {
  if (!value || typeof value !== "object") {
    return { saved: true, refreshed: true, effective: value };
  }
  const record = value as Record<string, unknown>;
  return {
    saved: record.saved === false ? false : true,
    refreshed: record.refreshed === false ? false : true,
    ...(record.effective !== undefined ? { effective: record.effective } : {}),
    ...(Array.isArray(record.warnings)
      ? { warnings: record.warnings.filter((entry): entry is string => typeof entry === "string") }
      : {}),
    ...(Array.isArray(record.refreshFailures)
      ? {
        refreshFailures: record.refreshFailures
          .filter((entry): entry is { target: string; message: string } => (
            !!entry
            && typeof entry === "object"
            && typeof (entry as { target?: unknown }).target === "string"
            && typeof (entry as { message?: unknown }).message === "string"
          ))
          .map((entry) => ({ target: entry.target, message: entry.message })),
      }
      : {}),
  };
}

function mapCommandsError(cause: unknown): PiviManagementError {
  if (cause instanceof PiviManagementError) return cause;
  if (cause instanceof PiviCommandsManagementError) {
    if (cause.code === "state_changed") {
      return new PiviManagementError("state_changed", cause.message, { cause });
    }
    return new PiviManagementError("validation_failed", cause.message, { cause });
  }
  return new PiviManagementError(
    "persistence_failed",
    cause instanceof Error ? cause.message : "Command mutation failed.",
    { cause: cause instanceof Error ? cause : undefined },
  );
}

function mapPromptError(cause: unknown): PiviManagementError {
  if (cause instanceof PiviManagementError) return cause;
  return new PiviManagementError(
    "persistence_failed",
    cause instanceof Error ? cause.message : "Prompt mutation failed.",
    { cause: cause instanceof Error ? cause : undefined },
  );
}

function freezeApprovalRequest(
  request: PiviManagementApprovalRequest,
): PiviManagementApprovalRequest {
  return Object.freeze({
    domain: request.domain,
    action: request.action,
    title: request.title,
    revision: request.revision,
    ...(request.changeLines
      ? { changeLines: Object.freeze([...request.changeLines]) }
      : {}),
    ...(request.fields
      ? {
        fields: Object.freeze(
          request.fields.map((field) => Object.freeze({
            label: field.label,
            value: isPlanValueArray(field.value)
              ? Object.freeze([...field.value])
              : field.value,
          })),
        ),
      }
      : {}),
  });
}

function isPlanValueArray(
  value: PiviManagementPlanField['value'],
): value is readonly PiviManagementPlanValue[] {
  return Array.isArray(value);
}

// Approval presentation is intentionally app-local and pure; this service only sequences it.

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new PiviManagementError("cancelled", "Management confirmation was cancelled.");
  }
}

function isAbortError(cause: unknown): boolean {
  return cause instanceof Error && (cause.name === "AbortError" || /aborted/i.test(cause.message));
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

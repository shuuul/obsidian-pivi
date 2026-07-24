import * as fs from 'node:fs';
import * as path from 'node:path';

import { ExternalFileApi } from '@pivi/obsidian-host/externalFileApi';
import { normalizePathForFilesystem } from '@pivi/obsidian-host/path';
import type {
  CapabilityApprovalRequest,
  CapabilityApprovalResult,
} from '@pivi/pivi-agent-core/ports';
import {
  TOOL_OBSIDIAN_BASH,
  TOOL_OBSIDIAN_LIST_EXTERNAL,
  TOOL_OBSIDIAN_READ_EXTERNAL,
} from '@pivi/pivi-agent-core/tools';

import type { ExternalFileApiLike, ObsidianToolDeps } from './obsidian/deps';

const OUTSIDE_ALLOWED_PATTERN = /outside allowed directories/i;
const NOT_IN_ALLOWLIST_PATTERN = /not in allowlist/i;

export function resolveExternalDirectoryRoot(
  absolutePath: string,
  expectDirectory: boolean,
): string {
  const normalized = normalizePathForFilesystem(absolutePath);
  if (!normalized) {
    throw new Error('Invalid external path: empty path');
  }
  if (expectDirectory) {
    return normalized;
  }
  try {
    const stat = fs.statSync(normalized);
    if (stat.isDirectory()) {
      return normalized;
    }
  } catch {
    // Fall through to parent directory for missing or unreadable paths.
  }
  const parent = path.dirname(normalized);
  if (!parent || parent === normalized) {
    return normalized;
  }
  return parent;
}


function buildExternalApprovalRequest(
  toolName: string,
  blockedPath: string,
  directoryRoot: string,
): CapabilityApprovalRequest {
  return {
    kind: 'external-directory',
    toolName,
    blockedPath,
    directoryRoot,
    reason: 'Path is outside allowed external directories.',
    description: `Access external path: ${blockedPath}`,
  };
}

function buildBashApprovalRequest(command: string): CapabilityApprovalRequest {
  return {
    kind: 'bash',
    toolName: TOOL_OBSIDIAN_BASH,
    command,
    blockedPath: command,
    reason: 'Command is not on the Bash allowlist.',
    description: `Run command: ${command}`,
  };
}

function externalFilesWithExtraRoot(
  deps: ObsidianToolDeps,
  extraRoot: string,
): ExternalFileApiLike {
  const baseApi = deps.externalFiles;
  if (baseApi instanceof ExternalFileApi) {
    return baseApi.withAdditionalAllowedDirectories([extraRoot]);
  }
  return new ExternalFileApi([extraRoot]);
}

async function resolveExternalApproval(
  deps: ObsidianToolDeps,
  request: CapabilityApprovalRequest,
): Promise<CapabilityApprovalResult> {
  const port = deps.capabilityApproval;
  if (!port) {
    return { decision: 'deny' };
  }
  if (port.hasSessionGrant(request)) {
    return { decision: 'allow-session' };
  }
  return port.requestApproval(request);
}

export async function ensureExternalDirectoryAccess(
  deps: ObsidianToolDeps,
  absolutePath: string,
  expectDirectory: boolean,
  toolName: string,
): Promise<ExternalFileApiLike> {
  const directoryRoot = resolveExternalDirectoryRoot(absolutePath, expectDirectory);
  if (deps.externalFiles.isPathAllowed?.(absolutePath) ?? false) {
    return deps.externalFiles;
  }
  const request = buildExternalApprovalRequest(toolName, absolutePath, directoryRoot);
  const port = deps.capabilityApproval;
  if (port?.hasSessionGrant(request)) {
    return externalFilesWithExtraRoot(deps, directoryRoot);
  }
  const result = await resolveExternalApproval(deps, request);
  if (result.decision === 'deny' || result.decision === 'cancel') {
    throw new Error(`External access denied by user: ${absolutePath}`);
  }
  return externalFilesWithExtraRoot(deps, directoryRoot);
}

export async function ensureBashCommandAllowed(
  deps: ObsidianToolDeps,
  normalizedCommand: string,
  isAllowlisted: boolean,
): Promise<void> {
  if (isAllowlisted) {
    return;
  }
  const request = buildBashApprovalRequest(normalizedCommand);
  const port = deps.capabilityApproval;
  if (!port) {
    throw new Error(`Bash command not in allowlist: ${normalizedCommand.split(/\s+/)[0]}`);
  }
  if (port.hasSessionGrant(request)) {
    return;
  }
  const result = await port.requestApproval(request);
  if (result.decision === 'deny' || result.decision === 'cancel') {
    throw new Error(`Bash command denied by user: ${normalizedCommand}`);
  }
}

export function isCapabilityDeniedError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  return /denied by user/i.test(error.message)
    || NOT_IN_ALLOWLIST_PATTERN.test(error.message)
    || OUTSIDE_ALLOWED_PATTERN.test(error.message);
}

export const CAPABILITY_TOOL_NAMES = {
  readExternal: TOOL_OBSIDIAN_READ_EXTERNAL,
  listExternal: TOOL_OBSIDIAN_LIST_EXTERNAL,
  bash: TOOL_OBSIDIAN_BASH,
} as const;

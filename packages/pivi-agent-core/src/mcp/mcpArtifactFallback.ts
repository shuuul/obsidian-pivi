/**
 * Bounded Vault-local fallback when an MCP tool result exceeds budgets.
 * Full oversized payloads never enter model context or session JSONL.
 */

import { MCP_RESULT_MAX_ENCODED_BYTES } from '../runtime/highRisk/types';

export const MCP_ARTIFACT_DIR = '.pivi/artifacts/mcp';
/** Artifact files are capped to the same encoded-byte budget as context materialization. */
export const MCP_ARTIFACT_MAX_BYTES = MCP_RESULT_MAX_ENCODED_BYTES;

function sanitizePathSegment(value: string): string {
  const cleaned = value
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 64);
  return cleaned || 'unknown';
}

export function buildMcpArtifactVaultPath(serverName: string, toolName: string, now = Date.now()): string {
  const stamp = Number.isFinite(now) ? String(Math.trunc(now)) : '0';
  return `${MCP_ARTIFACT_DIR}/${sanitizePathSegment(serverName)}/${sanitizePathSegment(toolName)}-${stamp}.txt`;
}

/**
 * Serialize MCP result content for a Vault artifact under a fixed byte budget.
 * Never returns unbounded output.
 */
export function serializeBoundedMcpArtifact(
  content: unknown,
  violation: string,
): string {
  const header = [
    `MCP result exceeded budget (${violation}).`,
    'This artifact is size-bounded; full oversized payloads never enter chat context or session history.',
    '',
  ].join('\n');

  let body: string;
  try {
    body = typeof content === 'string' ? content : JSON.stringify(content, null, 2);
  } catch {
    body = String(content);
  }
  if (typeof body !== 'string') {
    body = String(body);
  }

  const headerBytes = Buffer.byteLength(header, 'utf8');
  const truncationNote = `\n\n[truncated: artifact capped at ${MCP_ARTIFACT_MAX_BYTES} bytes]`;
  const truncationBytes = Buffer.byteLength(truncationNote, 'utf8');
  const remaining = Math.max(0, MCP_ARTIFACT_MAX_BYTES - headerBytes);
  const bodyBuf = Buffer.from(body, 'utf8');
  if (bodyBuf.byteLength <= remaining) {
    return header + body;
  }

  const bodyBudget = Math.max(0, remaining - truncationBytes);
  const truncated = bodyBuf.subarray(0, bodyBudget).toString('utf8');
  return `${header}${truncated}${truncationNote}`;
}

export function formatMcpArtifactReference(
  serverName: string,
  toolName: string,
  violation: string,
  vaultRelativePath: string,
): string {
  return (
    `MCP tool "${toolName}" on "${serverName}" exceeded result budget (${violation}). `
    + `Bounded artifact saved at: ${vaultRelativePath}`
  );
}

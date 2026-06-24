import { getActionPattern } from '../../../core/security/ApprovalManager';
import {
  TOOL_OBSIDIAN_DELETE,
  TOOL_OBSIDIAN_EDIT,
  TOOL_OBSIDIAN_MKDIR,
  TOOL_OBSIDIAN_MOVE,
  TOOL_OBSIDIAN_PROPERTIES,
  TOOL_OBSIDIAN_TASKS,
  TOOL_OBSIDIAN_WRITE,
} from '../../../core/tools/obsidianToolNames';
import { normalizePathForVault } from '../../../utils/path';
import type { ObsidianVaultApi } from '../ObsidianVaultApi';

const VAULT_PATH_TOOLS = new Set<string>([
  TOOL_OBSIDIAN_EDIT,
  TOOL_OBSIDIAN_WRITE,
  TOOL_OBSIDIAN_DELETE,
  TOOL_OBSIDIAN_MOVE,
  TOOL_OBSIDIAN_MKDIR,
  TOOL_OBSIDIAN_PROPERTIES,
  TOOL_OBSIDIAN_TASKS,
]);

function resolveVaultRelativePath(
  vault: ObsidianVaultApi,
  vaultPath: string | null,
  input: Record<string, unknown>,
): string | null {
  const pathValue = typeof input.path === 'string' ? input.path.trim() : '';
  if (pathValue) {
    return normalizePathForVault(pathValue, vaultPath) ?? pathValue.replace(/\\/g, '/');
  }

  const fileValue = typeof input.file === 'string' ? input.file.trim() : '';
  if (!fileValue) {
    return null;
  }

  const resolved = vault.resolveFile(fileValue, undefined);
  if (resolved) {
    return resolved.path.replace(/\\/g, '/');
  }

  return fileValue.endsWith('.md') ? fileValue.replace(/\\/g, '/') : `${fileValue}.md`;
}

export function createResolveApprovalPattern(
  vault: ObsidianVaultApi,
  vaultPath: string | null,
): (toolName: string, input: Record<string, unknown>) => string | null {
  return (toolName, input) => {
    if (VAULT_PATH_TOOLS.has(toolName)) {
      const vaultRelative = resolveVaultRelativePath(vault, vaultPath, input);
      if (vaultRelative) {
        return vaultRelative;
      }
    }
    return getActionPattern(toolName, input);
  };
}

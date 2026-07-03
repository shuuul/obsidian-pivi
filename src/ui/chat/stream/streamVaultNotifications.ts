import { ObsidianVaultApi } from '@pivi/obsidian-host';

import type PiviPlugin from '@/app/PiviPluginHost';

export function notifyVaultFileChange(plugin: PiviPlugin, input: Record<string, unknown>): void {
  const rawPathValue = input.file_path ?? input.notebook_path;
  const rawPath = typeof rawPathValue === 'string' ? rawPathValue : undefined;
  if (!rawPath) return;

  window.setTimeout(() => {
    const vaultApi = new ObsidianVaultApi(plugin.app);
    vaultApi.triggerVaultModify(rawPath);
  }, 200);
}

export function notifyObsidianVaultPathChange(
  plugin: PiviPlugin,
  input: Record<string, unknown>,
): void {
  const rawPath = typeof input.path === 'string' && input.path.trim()
    ? input.path.trim()
    : typeof input.file === 'string' && input.file.trim()
      ? input.file.trim()
      : undefined;
  if (!rawPath) {
    return;
  }
  notifyVaultFileChange(plugin, { file_path: rawPath });
}

/** Refreshes vault for each file path in an apply_patch changes array or patch text. */
export function notifyApplyPatchFileChanges(
  plugin: PiviPlugin,
  input: Record<string, unknown>,
): void {
  const notified = new Set<string>();

  const changes = input.changes;
  if (Array.isArray(changes)) {
    for (const change of changes) {
      if (change && typeof change === 'object' && !Array.isArray(change)) {
        const changeRecord = change as Record<string, unknown>;
        if (typeof changeRecord.path === 'string') {
          notified.add(changeRecord.path);
          notifyVaultFileChange(plugin, { file_path: changeRecord.path });
        }
      }
    }
  }

  const patchText = typeof input.patch === 'string' ? input.patch : '';
  if (patchText) {
    for (const match of patchText.matchAll(/^\*\*\* (?:Add|Update|Delete) File: (.+)$/gm)) {
      const filePath = match[1]?.trim();
      if (filePath && !notified.has(filePath)) {
        notifyVaultFileChange(plugin, { file_path: filePath });
      }
    }
  }
}
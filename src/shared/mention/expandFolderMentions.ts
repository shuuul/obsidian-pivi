import type { App } from 'obsidian';

import type { MentionBadgeParseContext } from './mentionBadgeTypes';
import { parseMessageMentions } from './parseMessageMentions';

/** Lists vault-relative file paths under a folder (recursive, paths only). */
export function listVaultFilePathsUnderFolder(app: App, folderPath: string): string[] {
  const normalized = folderPath.replace(/\\/g, '/').replace(/\/+$/, '');
  const prefix = normalized ? `${normalized}/` : '';

  return app.vault
    .getFiles()
    .filter((file) => !prefix || file.path.startsWith(prefix))
    .map((file) => file.path)
    .sort((a, b) => a.localeCompare(b));
}

/** Resolves @folder mentions in message text to vault file paths (no content reads). */
export function collectFolderMentionFilePaths(
  text: string,
  ctx: MentionBadgeParseContext,
): string[] {
  if (!text.includes('@')) {
    return [];
  }

  const parts = parseMessageMentions(text, ctx);
  const folderPaths = new Set<string>();

  for (const part of parts) {
    if (part.kind === 'folder') {
      folderPaths.add(part.path);
    }
  }

  const filePaths = new Set<string>();
  for (const folderPath of folderPaths) {
    for (const path of listVaultFilePathsUnderFolder(ctx.app, folderPath)) {
      filePaths.add(path);
    }
  }

  return [...filePaths].sort((a, b) => a.localeCompare(b));
}

/** Merges chip-attached paths with folder-expanded paths for `<context_files>`. */
export function mergeContextFilePaths(
  attachedPaths: Iterable<string> | undefined,
  folderExpandedPaths: string[],
): string[] | undefined {
  const merged = new Set<string>();

  if (attachedPaths) {
    for (const path of attachedPaths) {
      const trimmed = path.trim();
      if (trimmed) {
        merged.add(trimmed);
      }
    }
  }

  for (const path of folderExpandedPaths) {
    merged.add(path);
  }

  if (merged.size === 0) {
    return undefined;
  }

  return [...merged].sort((a, b) => a.localeCompare(b));
}

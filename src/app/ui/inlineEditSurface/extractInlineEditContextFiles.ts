import type { MentionBadgeParseContext } from '@pivi/pivi-agent-core/context/mentions';
import { parseMessageMentions } from '@pivi/pivi-agent-core/context/mentions';

import {
  collectFolderMentionFilePaths,
  mergeContextFilePaths,
} from '@/ui/shared/mention/expandFolderMentions';

/**
 * Resolves @file and expanded @folder mentions from inline edit prompt text.
 */
export function extractInlineEditContextFiles(
  text: string,
  ctx: MentionBadgeParseContext,
): string[] {
  if (!text.trim()) {
    return [];
  }

  const directFilePaths: string[] = [];
  for (const part of parseMessageMentions(text, ctx)) {
    if (part.kind === 'file') {
      directFilePaths.push(part.path);
    }
  }

  const folderExpandedPaths = collectFolderMentionFilePaths(text, ctx);
  return mergeContextFilePaths(directFilePaths, folderExpandedPaths) ?? [];
}

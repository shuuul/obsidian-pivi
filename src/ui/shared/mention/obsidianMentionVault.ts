import { normalizeMentionPath } from '@pivi/pivi-agent-core/context/mentions';
import type { App } from 'obsidian';
import { parseFrontMatterAliases, TFile, TFolder } from 'obsidian';

export function getVaultFileAliases(app: Pick<App, 'metadataCache'>, file: TFile): string[] {
  const cache = app.metadataCache?.getFileCache?.(file);
  return parseFrontMatterAliases(cache?.frontmatter ?? null) ?? [];
}

export function resolveVaultWikilinkTarget(
  app: Pick<App, 'metadataCache' | 'vault'>,
  linkPath: string,
  sourcePath = '',
): TFile | TFolder | null {
  const normalizedPath = normalizeMentionPath(linkPath);
  const direct = app.vault.getAbstractFileByPath(normalizedPath);
  if (direct instanceof TFile || direct instanceof TFolder) return direct;

  if (!/\.[^/]+$/.test(normalizedPath)) {
    const markdownFile = app.vault.getAbstractFileByPath(`${normalizedPath}.md`);
    if (markdownFile instanceof TFile) return markdownFile;
  }

  const linkedFile = app.metadataCache?.getFirstLinkpathDest?.(linkPath, sourcePath);
  return linkedFile instanceof TFile ? linkedFile : null;
}

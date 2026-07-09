import type { DiffStats } from '@pivi/pivi-agent-core/foundation/diff';
import { parseApplyPatchDiffs, parseFileUpdateChangeDiffs } from '@pivi/pivi-agent-core/tools/diff';

import { t } from '@/i18n';

import { renderDiffContent } from './DiffRenderer';
import { renderLinesExpanded } from './toolCallExpandedShared';

export function renderApplyPatchExpanded(
  container: HTMLElement,
  input: Record<string, unknown>,
  result: string | undefined,
): void {
  const patchText = typeof input.patch === 'string' ? input.patch : '';
  const parsedDiffs = getApplyPatchFileDiffs(input);

  if (result && /verification failed|^[Ee]rror:/.test(result.trim())) {
    renderLinesExpanded(container, result, 20);
  }

  if (parsedDiffs.length > 0) {
    renderApplyPatchDiffSections(container, parsedDiffs);
    return;
  }

  const changes = Array.isArray(input.changes) ? input.changes : [];
  if (changes.length > 0) {
    const linesEl = container.createDiv({ cls: 'pivi-tool-lines' });
    for (const change of changes as unknown[]) {
      if (!change || typeof change !== 'object' || Array.isArray(change)) continue;
      const changeRecord = change as Record<string, unknown>;
      const path = typeof changeRecord.path === 'string' ? changeRecord.path : '';
      if (!path) continue;
      const movedTo = readMoveTarget(changeRecord.kind);
      const pathText = movedTo ? `${path} -> ${movedTo}` : path;
      linesEl.createDiv({ cls: 'pivi-tool-line', text: pathText });
    }
    return;
  }

  if (patchText) {
    renderLinesExpanded(container, patchText, 80);
    return;
  }

  if (result) {
    const fileMatches = [...result.matchAll(/(?:update|add|delete|create|modify|Applied:\s*)(?:\w+:\s*)?([^\n,]+)/gi)];
    if (fileMatches.length > 0) {
      const linesEl = container.createDiv({ cls: 'pivi-tool-lines' });
      for (const match of fileMatches) {
        const filePath = match[1]?.trim();
        if (filePath) {
          const lineEl = linesEl.createDiv({ cls: 'pivi-tool-line' });
          lineEl.setText(filePath);
        }
      }
      return;
    }
    renderLinesExpanded(container, result, 20);
    return;
  }

  container.createDiv({ cls: 'pivi-tool-empty', text: t('chat.stream.noResult') });
}

export function renderApplyPatchDiffSections(
  container: HTMLElement,
  fileDiffs: ReturnType<typeof parseApplyPatchDiffs>,
): void {
  for (const fileDiff of fileDiffs) {
    const sectionEl = container.createDiv({ cls: 'pivi-tool-patch-section' });

    if (fileDiff.operation === 'delete' && fileDiff.diffLines.length === 0) {
      sectionEl.createDiv({ cls: 'pivi-tool-empty', text: t('chat.stream.fileDeleted') });
      continue;
    }

    if (fileDiff.diffLines.length === 0) {
      sectionEl.createDiv({ cls: 'pivi-tool-empty', text: t('chat.stream.noTextualDiff') });
      continue;
    }

    const diffRow = sectionEl.createDiv({ cls: 'pivi-write-edit-diff-row' });
    const diffEl = diffRow.createDiv({ cls: 'pivi-write-edit-diff' });
    renderDiffContent(diffEl, fileDiff.diffLines);
  }
}

export function readMoveTarget(kind: unknown): string | undefined {
  if (!kind || typeof kind !== 'object' || Array.isArray(kind)) {
    return undefined;
  }
  const record = kind as Record<string, unknown>;
  return typeof record.move_path === 'string' ? record.move_path : undefined;
}

export function getApplyPatchFileDiffs(input: Record<string, unknown>): ReturnType<typeof parseApplyPatchDiffs> {
  const patchText = typeof input.patch === 'string' ? input.patch : '';
  const parsedDiffs = patchText ? parseApplyPatchDiffs(patchText) : [];
  return parsedDiffs.length > 0 ? parsedDiffs : parseFileUpdateChangeDiffs(input.changes);
}

export function getApplyPatchDiffStats(input: Record<string, unknown>): DiffStats | undefined {
  const fileDiffs = getApplyPatchFileDiffs(input);
  if (fileDiffs.length === 0) return undefined;

  const stats = fileDiffs.reduce<DiffStats>(
    (acc, fileDiff) => ({
      added: acc.added + fileDiff.stats.added,
      removed: acc.removed + fileDiff.stats.removed,
    }),
    { added: 0, removed: 0 }
  );

  return stats.added > 0 || stats.removed > 0 ? stats : undefined;
}

export function getDiffStatsAriaLabel(stats: DiffStats): string {
  return `Changes: +${stats.added} -${stats.removed}`;
}

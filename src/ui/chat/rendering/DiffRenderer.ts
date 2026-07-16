import type { DiffLine, DiffStats } from '@pivi/pivi-agent-core/foundation/diff';

import { t } from '@/app/i18n';

export function renderDiffStats(statsEl: HTMLElement, stats: DiffStats): void {
  if (stats.added > 0) {
    const addedEl = statsEl.createSpan({ cls: 'added' });
    addedEl.setText(`+${stats.added}`);
  }
  if (stats.removed > 0) {
    if (stats.added > 0) {
      statsEl.createSpan({ text: ' ' });
    }
    const removedEl = statsEl.createSpan({ cls: 'removed' });
    removedEl.setText(`-${stats.removed}`);
  }
}

export function renderDiffContent(
  containerEl: HTMLElement,
  diffLines: DiffLine[],
): void {
  containerEl.empty();
  if (!diffLines.some(line => line.type !== 'equal')) {
    // No changes
    const noChanges = containerEl.createDiv({ cls: 'pivi-diff-no-changes' });
    noChanges.setText(t('chat.stream.noChanges'));
    return;
  }

  const hunkEl = containerEl.createDiv({ cls: 'pivi-diff-hunk' });
  for (const line of diffLines) {
    const lineEl = hunkEl.createDiv({ cls: `pivi-diff-line pivi-diff-${line.type}` });

    // Line prefix
    const prefix = line.type === 'insert' ? '+' : line.type === 'delete' ? '-' : ' ';
    const prefixEl = lineEl.createSpan({ cls: 'pivi-diff-prefix' });
    prefixEl.setText(prefix);

    // Line content
    const contentEl = lineEl.createSpan({ cls: 'pivi-diff-text' });
    contentEl.setText(line.text || ' '); // Show space for empty lines
  }
}

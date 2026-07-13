import type { ToolCallInfo } from '@pivi/pivi-agent-core/foundation';

import { t } from '@/app/i18n';

import { renderDiffContent } from './DiffRenderer';

/** Render only the body owned by the surrounding generic tool shell. */
export function renderWriteEditContent(container: HTMLElement, toolCall: ToolCallInfo): void {
  container.addClass('pivi-write-edit-content');
  const row = container.createDiv({ cls: 'pivi-write-edit-diff-row' });
  const isError = toolCall.status === 'error' || toolCall.status === 'blocked';

  if (toolCall.diffData?.diffLines.length) {
    const diffEl = row.createDiv({ cls: 'pivi-write-edit-diff' });
    renderDiffContent(diffEl, toolCall.diffData.diffLines);
    return;
  }

  if (isError) {
    row.createDiv({
      cls: 'pivi-write-edit-error',
      text: toolCall.result || t('common.error'),
    });
    return;
  }

  row.createDiv({
    cls: toolCall.status === 'running' ? 'pivi-write-edit-loading' : 'pivi-write-edit-done-text',
    text: toolCall.status === 'running' ? t('chat.stream.writing') : t('chat.stream.statusDone'),
  });
}

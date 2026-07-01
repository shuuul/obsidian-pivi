import { setIcon } from 'obsidian';

import type { QueuedMessage } from '../state/types';
import { formatQueuedMessagePreview } from './inputQueue';

export interface QueueIndicatorRenderOptions {
  indicatorEl: HTMLElement | null;
  queuedMessage: QueuedMessage | null;
  onEdit: () => void;
  onDiscard: () => void;
}

export function renderQueueIndicator(options: QueueIndicatorRenderOptions): void {
  const { indicatorEl } = options;
  if (!indicatorEl) return;

  indicatorEl.empty();

  if (!options.queuedMessage) {
    indicatorEl.removeClass('pivi-visible-flex');
    indicatorEl.addClass('pivi-hidden');
    return;
  }

  indicatorEl.createSpan({
    cls: 'pivi-queue-indicator-text',
    text: `⌙ Queued: ${formatQueuedMessagePreview(options.queuedMessage)}`,
  });

  renderQueueActions(indicatorEl, options);

  indicatorEl.addClass('pivi-visible-flex');
  indicatorEl.removeClass('pivi-hidden');
}

function renderQueueActions(
  indicatorEl: HTMLElement,
  options: QueueIndicatorRenderOptions,
): void {
  const actionsEl = indicatorEl.createDiv({ cls: 'pivi-queue-indicator-actions' });

  const editButton = createQueueIconButton(
    actionsEl,
    'pencil',
    'Edit queued message',
  );
  editButton.addEventListener('click', (event) => {
    event.stopPropagation();
    options.onEdit();
  });

  const discardButton = createQueueIconButton(
    actionsEl,
    'trash-2',
    'Discard queued message',
  );
  discardButton.addEventListener('click', (event) => {
    event.stopPropagation();
    options.onDiscard();
  });
}

function createQueueIconButton(
  parentEl: HTMLElement,
  icon: string,
  label: string,
): HTMLElement {
  const button = parentEl.createEl('button', {
    cls: 'pivi-queue-indicator-icon-action',
    attr: {
      'aria-label': label,
      title: label,
      type: 'button',
    },
  });
  setIcon(button, icon);
  return button;
}

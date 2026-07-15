import type { ActivityStatus } from '@pivi/pivi-agent-core/foundation';
import { setIcon } from 'obsidian';

import { t, type TFunction } from '@/app/i18n';

export function getActivityStatusLabel(
  status: ActivityStatus,
  translate: TFunction = t,
): string {
  switch (status) {
    case 'queued': return translate('chat.status.queued');
    case 'running': return translate('chat.status.running');
    case 'waiting': return translate('chat.status.waiting');
    case 'completed': return translate('chat.status.completed');
    case 'failed': return translate('chat.status.failed');
    case 'cancelled': return translate('chat.status.cancelled');
    case 'orphaned': return translate('chat.status.orphaned');
  }
}

export function renderActivityStatusContents(
  container: HTMLElement,
  status: ActivityStatus,
): void {
  container.empty();
  container.setAttribute('aria-atomic', 'true');
  container.setAttribute('aria-live', 'polite');

  if (status === 'queued') {
    container.createSpan({ cls: 'pivi-status-icon-dot', attr: { 'aria-hidden': 'true' } });
  } else if (status === 'running') {
    const workingIconEl = container.createSpan({
      cls: 'pivi-working-icon',
      attr: { 'aria-hidden': 'true' },
    });
    setIcon(workingIconEl, 'loader-circle');
  } else {
    const icon = status === 'waiting'
      ? 'pause'
      : status === 'completed'
        ? 'check'
        : status === 'failed'
          ? 'x'
          : status === 'cancelled'
            ? 'square'
            : 'unplug';
    const iconEl = container.createSpan({ cls: 'pivi-activity-status-icon', attr: { 'aria-hidden': 'true' } });
    setIcon(iconEl, icon);
  }

  container.createSpan({
    cls: 'pivi-activity-status-label',
    text: getActivityStatusLabel(status),
  });
  if (status === 'orphaned') {
    container.setAttribute('aria-label', `${getActivityStatusLabel(status)}. ${t('chat.status.orphanedDescription')}`);
  } else {
    container.removeAttribute('aria-label');
  }
}

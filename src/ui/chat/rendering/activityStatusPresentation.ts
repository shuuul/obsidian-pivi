import type { ActivityStatus } from '@pivi/pivi-agent-core/foundation';
import {
  type ActivityStatusPresentation,
  getActivityStatusPresentation,
} from '@pivi/pivi-react/store';
import { setIcon } from 'obsidian';

import { t } from '@/app/i18n';

export function renderActivityStatusContents(
  container: HTMLElement,
  status: ActivityStatus,
): ActivityStatusPresentation {
  const presentation = getActivityStatusPresentation(status, t);
  container.empty();
  container.setAttribute('aria-atomic', 'true');
  container.setAttribute('aria-live', 'polite');

  if (presentation.icon.kind === 'dot') {
    container.createSpan({ cls: 'pivi-status-icon-dot', attr: { 'aria-hidden': 'true' } });
  } else if (presentation.icon.kind === 'working') {
    const workingIconEl = container.createSpan({
      cls: 'pivi-working-icon',
      attr: { 'aria-hidden': 'true' },
    });
    setIcon(workingIconEl, 'loader-circle');
  } else {
    const iconEl = container.createSpan({ cls: 'pivi-activity-status-icon', attr: { 'aria-hidden': 'true' } });
    setIcon(iconEl, presentation.icon.name);
  }

  container.createSpan({
    cls: 'pivi-activity-status-label',
    text: presentation.label,
  });
  if (presentation.accessibleLabel) {
    container.setAttribute('aria-label', presentation.accessibleLabel);
  } else {
    container.removeAttribute('aria-label');
  }
  return presentation;
}

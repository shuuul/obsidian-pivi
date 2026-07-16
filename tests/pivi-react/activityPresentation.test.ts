import type { ActivityStatus } from '@pivi/pivi-agent-core/foundation';
import { createI18n } from '@pivi/pivi-react';
import {
  formatActivityElapsed,
  getActivityStatusPresentation,
} from '@pivi/pivi-react/store';

describe('activity presentation', () => {
  it('defines the localized label and icon treatment for every lifecycle status', () => {
    const t = createI18n().t;
    const expected: Record<ActivityStatus, {
      accessibleLabel: string | undefined;
      icon: string;
      label: string;
    }> = {
      queued: { accessibleLabel: undefined, icon: 'dot', label: 'Queued' },
      running: { accessibleLabel: undefined, icon: 'working', label: 'Running' },
      waiting: { accessibleLabel: undefined, icon: 'platform:pause', label: 'Waiting' },
      completed: { accessibleLabel: undefined, icon: 'platform:check', label: 'Completed' },
      failed: { accessibleLabel: undefined, icon: 'platform:x', label: 'Failed' },
      cancelled: { accessibleLabel: undefined, icon: 'platform:square', label: 'Cancelled' },
      orphaned: {
        accessibleLabel: 'Orphaned. The session ended before this activity completed. Start it again to recover.',
        icon: 'platform:unplug',
        label: 'Orphaned',
      },
    };

    for (const status of Object.keys(expected) as ActivityStatus[]) {
      const presentation = getActivityStatusPresentation(status, t);
      const icon = presentation.icon.kind === 'platform'
        ? `platform:${presentation.icon.name}`
        : presentation.icon.kind;
      expect({
        accessibleLabel: presentation.accessibleLabel,
        icon,
        label: presentation.label,
      }).toEqual(expected[status]);
    }
  });

  it.each([
    [-1_000, '0s'],
    [999, '0s'],
    [1_000, '1s'],
    [61_000, '1m 01s'],
  ])('formats %i milliseconds as %s', (milliseconds, expected) => {
    expect(formatActivityElapsed(milliseconds)).toBe(expected);
  });
});

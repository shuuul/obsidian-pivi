import type { ActivityStatus } from '@pivi/pivi-agent-core/foundation';

import type { TFunction, TranslationKey } from '../i18n/types';

export type ActivityStatusIcon =
  | { readonly kind: 'dot' }
  | { readonly kind: 'working' }
  | {
      readonly kind: 'platform';
      readonly name: 'check' | 'pause' | 'square' | 'unplug' | 'x';
    };

export interface ActivityStatusPresentation {
  readonly accessibleLabel: string | undefined;
  readonly icon: ActivityStatusIcon;
  readonly label: string;
}

export interface ActivityStatusCountPresentation extends ActivityStatusPresentation {
  readonly count: number;
  readonly countLabel: string;
  readonly status: ActivityStatus;
}

interface ActivityStatusDescriptor {
  readonly descriptionKey?: TranslationKey;
  readonly icon: ActivityStatusIcon;
  readonly labelKey: TranslationKey;
}

const ACTIVITY_STATUS_DESCRIPTORS = {
  queued: {
    icon: { kind: 'dot' },
    labelKey: 'chat.status.queued',
  },
  running: {
    icon: { kind: 'working' },
    labelKey: 'chat.status.running',
  },
  waiting: {
    icon: { kind: 'platform', name: 'pause' },
    labelKey: 'chat.status.waiting',
  },
  completed: {
    icon: { kind: 'platform', name: 'check' },
    labelKey: 'chat.status.completed',
  },
  failed: {
    icon: { kind: 'platform', name: 'x' },
    labelKey: 'chat.status.failed',
  },
  cancelled: {
    icon: { kind: 'platform', name: 'square' },
    labelKey: 'chat.status.cancelled',
  },
  orphaned: {
    descriptionKey: 'chat.status.orphanedDescription',
    icon: { kind: 'platform', name: 'unplug' },
    labelKey: 'chat.status.orphaned',
  },
} satisfies Readonly<Record<ActivityStatus, ActivityStatusDescriptor>>;

const ACTIVITY_STATUS_COUNT_ORDER: readonly ActivityStatus[] = [
  'completed',
  'failed',
  'running',
  'waiting',
  'queued',
  'cancelled',
  'orphaned',
];

export function getActivityStatusPresentation(
  status: ActivityStatus,
  t: TFunction,
): ActivityStatusPresentation {
  const descriptor: ActivityStatusDescriptor = ACTIVITY_STATUS_DESCRIPTORS[status];
  const label = t(descriptor.labelKey);
  return {
    accessibleLabel: descriptor.descriptionKey
      ? `${label}. ${t(descriptor.descriptionKey)}`
      : undefined,
    icon: descriptor.icon,
    label,
  };
}

export function getActivityStatusCountPresentations(
  statuses: readonly ActivityStatus[],
  t: TFunction,
): readonly ActivityStatusCountPresentation[] {
  const counts = new Map<ActivityStatus, number>();
  for (const status of statuses) {
    counts.set(status, (counts.get(status) ?? 0) + 1);
  }
  return ACTIVITY_STATUS_COUNT_ORDER.flatMap((status) => {
    const count = counts.get(status) ?? 0;
    if (count === 0) return [];
    const presentation = getActivityStatusPresentation(status, t);
    return [{
      ...presentation,
      count,
      countLabel: t('chat.status.count', { count, status: presentation.label }),
      status,
    }];
  });
}

export function formatActivityElapsed(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1_000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m ${String(seconds).padStart(2, '0')}s` : `${seconds}s`;
}

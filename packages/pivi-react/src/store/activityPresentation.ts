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

export function formatActivityElapsed(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1_000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m ${String(seconds).padStart(2, '0')}s` : `${seconds}s`;
}

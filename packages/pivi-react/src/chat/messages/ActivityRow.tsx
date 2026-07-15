import type { ActivityStatus } from '@pivi/pivi-agent-core/foundation';
import type { ReactNode } from 'react';
import { useEffect, useRef, useState } from 'react';

import { useT } from '../../i18n/I18nProvider';
import { PlatformIcon } from '../../icons';

function getActivityStatusLabel(status: ActivityStatus, t: ReturnType<typeof useT>): string {
  switch (status) {
    case 'queued': return t('chat.status.queued');
    case 'running': return t('chat.status.running');
    case 'waiting': return t('chat.status.waiting');
    case 'completed': return t('chat.status.completed');
    case 'failed': return t('chat.status.failed');
    case 'cancelled': return t('chat.status.cancelled');
    case 'orphaned': return t('chat.status.orphaned');
  }
}

function StatusIcon({ status }: { readonly status: ActivityStatus }) {
  if (status === 'queued') {
    return <span className="pivi-status-icon-dot" aria-hidden="true" />;
  }
  if (status === 'running') {
    return (
      <span className="pivi-working-icon" aria-hidden="true">
        <svg viewBox="0 0 16 16" width="16" height="16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
          <circle className="pivi-working-icon-track" cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.5" opacity="0.25" />
          <path className="pivi-working-icon-arc" d="M8 2a6 6 0 0 1 6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </span>
    );
  }
  const icon = status === 'waiting'
    ? 'pause'
    : status === 'completed'
      ? 'check'
      : status === 'failed'
        ? 'x'
        : status === 'cancelled'
          ? 'square'
          : 'unplug';
  return <PlatformIcon name={icon} />;
}

export function ActivityStatusBadge({ status }: { readonly status: ActivityStatus }) {
  const t = useT();
  const label = getActivityStatusLabel(status, t);
  return (
    <span
      aria-label={status === 'orphaned'
        ? `${label}. ${t('chat.status.orphanedDescription')}`
        : undefined}
      aria-atomic="true"
      aria-live="polite"
      className={`pivi-activity-status pivi-tool-status status-${status}`}
    >
      <StatusIcon status={status} />
      <span className="pivi-activity-status-label">{label}</span>
    </span>
  );
}

function formatElapsed(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m ${String(seconds).padStart(2, '0')}s` : `${seconds}s`;
}

function ActivityElapsed({ completedAt, startedAt, status }: {
  readonly completedAt?: number;
  readonly startedAt?: number;
  readonly status: ActivityStatus;
}) {
  const elementRef = useRef<HTMLTimeElement>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const element = elementRef.current;
    const ownerWindow = element?.ownerDocument.defaultView;
    if (!element || !ownerWindow || !startedAt || status !== 'running') return;
    if (ownerWindow.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    const timer = ownerWindow.setInterval(() => setNow(Date.now()), 1_000);
    return () => ownerWindow.clearInterval(timer);
  }, [startedAt, status]);

  if (!startedAt) return null;
  const end = status === 'running' ? now : completedAt;
  if (!end) return null;
  return (
    <time
      aria-hidden="true"
      className="pivi-activity-elapsed"
      dateTime={`PT${Math.max(0, Math.floor((end - startedAt) / 1000))}S`}
      ref={elementRef}
    >
      {formatElapsed(end - startedAt)}
    </time>
  );
}

export interface ActivityRowProps {
  readonly completedAt?: number;
  readonly icon: ReactNode;
  readonly meta?: ReactNode;
  readonly name: ReactNode;
  readonly startedAt?: number;
  readonly status: ActivityStatus;
  readonly summary?: ReactNode;
}

export function ActivityRow({ completedAt, icon, meta, name, startedAt, status, summary }: ActivityRowProps) {
  return (
    <>
      <span className="pivi-activity-icon pivi-tool-icon" aria-hidden="true">{icon}</span>
      <span className="pivi-activity-name pivi-tool-name">{name}</span>
      <span className="pivi-activity-summary pivi-tool-summary">{summary}</span>
      {meta}
      <ActivityElapsed completedAt={completedAt} startedAt={startedAt} status={status} />
      <ActivityStatusBadge status={status} />
    </>
  );
}

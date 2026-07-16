import type { ActivityStatus } from '@pivi/pivi-agent-core/foundation';
import type { ReactNode } from 'react';
import { Fragment, useEffect, useRef, useState } from 'react';

import { useT } from '../../i18n/I18nProvider';
import { PlatformIcon } from '../../icons';
import {
  type ActivityStatusIcon,
  formatActivityElapsed,
  getActivityStatusCountPresentations,
  getActivityStatusPresentation,
} from '../../store/activityPresentation';

function StatusIcon({ icon }: { readonly icon: ActivityStatusIcon }) {
  if (icon.kind === 'dot') {
    return <span className="pivi-status-icon-dot" aria-hidden="true" />;
  }
  if (icon.kind === 'working') {
    return (
      <span className="pivi-working-icon" aria-hidden="true">
        <svg viewBox="0 0 16 16" width="16" height="16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
          <circle className="pivi-working-icon-track" cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.5" opacity="0.25" />
          <path className="pivi-working-icon-arc" d="M8 2a6 6 0 0 1 6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </span>
    );
  }
  return <PlatformIcon name={icon.name} />;
}

export function ActivityStatusBadge({ status }: { readonly status: ActivityStatus }) {
  const t = useT();
  const presentation = getActivityStatusPresentation(status, t);
  return (
    <span
      aria-label={presentation.accessibleLabel}
      aria-atomic="true"
      aria-live="polite"
      className={`pivi-activity-status pivi-tool-status status-${status}`}
    >
      <StatusIcon icon={presentation.icon} />
      <span className="pivi-activity-status-label">{presentation.label}</span>
    </span>
  );
}

export function ActivityStatusCountSummary({ statuses }: { readonly statuses: readonly ActivityStatus[] }) {
  const t = useT();
  const items = getActivityStatusCountPresentations(statuses, t);
  const accessibleLabel = items.map(item => item.countLabel).join(' / ');
  return (
    <span
      aria-label={accessibleLabel}
      aria-atomic="true"
      aria-live="polite"
      className="pivi-tool-step-group-status"
    >
      {items.map((item, index) => (
        <Fragment key={item.status}>
          {index > 0 ? <span aria-hidden="true" className="pivi-tool-step-group-status-separator">/</span> : null}
          <span aria-hidden="true" className={`pivi-activity-status pivi-tool-status status-${item.status}`}>
            <StatusIcon icon={item.icon} />
            <span className="pivi-activity-status-label">{item.countLabel}</span>
          </span>
        </Fragment>
      ))}
    </span>
  );
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
      {formatActivityElapsed(end - startedAt)}
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

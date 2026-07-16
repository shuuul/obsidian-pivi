import { ActivityRow } from '../../chat/messages/ActivityRow';
import { useT } from '../../i18n';
import { PlatformIcon } from '../../icons';
import type { ActiveWorkShelfItem } from '../activeChatUiBridge';

export function ActiveWorkShelf({
  onNavigate,
  items,
}: {
  readonly items: readonly ActiveWorkShelfItem[];
  readonly onNavigate: (tabId: string, messageId: string) => void;
}) {
  const t = useT();
  if (items.length === 0) return null;

  return (
    <section aria-label={t('chat.activity.activeWork')} className="pivi-active-work-shelf">
      <header>
        <span>{t('chat.activity.activeWork')}</span>
        <span>{items.length}</span>
      </header>
      <div className="pivi-active-work-items">
        {items.map(({ run, tabId }) => {
          const name = run.writerName ?? t('chat.activity.subagentTask');
          const summary = run.currentActivity?.toolName ?? run.description;
          return (
            <button
              aria-label={t('chat.activity.goToAgentRun', { agent: name })}
              className="pivi-active-work-item"
              data-agent-run-id={run.runId}
              key={`${tabId}:${run.runId}`}
              onClick={() => onNavigate(tabId, run.owningMessageId)}
              type="button"
            >
              <ActivityRow
                completedAt={run.completedAt}
                icon={<PlatformIcon name="bot" />}
                name={name}
                startedAt={run.startedAt}
                status={run.status}
                summary={summary}
              />
              <span aria-hidden="true" className="pivi-active-work-navigate">
                <PlatformIcon name="arrow-up-right" />
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

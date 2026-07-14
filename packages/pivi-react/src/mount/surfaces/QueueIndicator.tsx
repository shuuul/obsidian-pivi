import { useT } from '../../i18n';
import { PlatformIcon } from '../../icons';
import type { QueuedTurnSnapshot } from '../../store';
import type { ChatSurfaceActions } from '../types';

export function QueueIndicator({ queuedTurn, actions }: {
  queuedTurn: QueuedTurnSnapshot | null;
  actions: ChatSurfaceActions;
}) {
  const t = useT();
  if (!queuedTurn) return null;
  const preview = queuedTurn.content.trim();
  const shortPreview = preview.length > 40 ? `${preview.slice(0, 40)}...` : preview;
  const imageLabel = queuedTurn.imageCount > 0 ? t('chat.queue.images') : '';
  const display = [shortPreview, imageLabel].filter(Boolean).join(' · ');
  return (
    <div className="pivi-input-queue-row pivi-visible-flex">
      <span className="pivi-queue-indicator-text">{t('chat.queue.queued', { preview: display })}</span>
      <span className="pivi-queue-indicator-actions">
        <button aria-label={t('chat.queue.edit')} className="pivi-queue-indicator-icon-action" onClick={actions.editQueuedTurn} type="button">
          <PlatformIcon name="pencil" />
        </button>
        <button aria-label={t('chat.queue.discard')} className="pivi-queue-indicator-icon-action" onClick={actions.discardQueuedTurn} type="button">
          <PlatformIcon name="trash-2" />
        </button>
      </span>
    </div>
  );
}

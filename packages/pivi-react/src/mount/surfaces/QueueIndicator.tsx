import { type CSSProperties, type KeyboardEvent, type PointerEvent, useEffect, useState } from 'react';

import { useT } from '../../i18n';
import { PlatformIcon } from '../../icons';
import {
  type SortableReorderHandleProps,
  useSortableReorder,
} from '../../reorder/useSortableReorder';
import type { QueuedTurnSnapshot } from '../../store';
import type { ChatSurfaceActions } from '../types';

function QueueItem({ queuedTurn, actions, dragging, dragOffset, position, total, reorderHandleProps }: {
  queuedTurn: QueuedTurnSnapshot;
  actions: ChatSurfaceActions;
  dragging: boolean;
  dragOffset: number;
  position: number;
  total: number;
  reorderHandleProps: SortableReorderHandleProps<HTMLDivElement>;
}) {
  const t = useT();
  const preview = queuedTurn.content.trim();
  const shortPreview = preview.length > 40 ? `${preview.slice(0, 40)}...` : preview;
  const imageLabel = queuedTurn.imageCount > 0 ? t('chat.queue.images') : '';
  const display = [shortPreview, imageLabel].filter(Boolean).join(' · ');
  const style = dragging
    ? { '--pivi-queue-drag-y': `${dragOffset}px` } as CSSProperties
    : undefined;
  const onPointerDown = (event: PointerEvent<HTMLDivElement>): void => {
    if ((event.target as Element).closest('button')) return;
    reorderHandleProps.onPointerDown(event);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.target !== event.currentTarget) return;
    reorderHandleProps.onKeyDown(event);
  };
  return (
    <div
      aria-label={t('chat.queue.reorder.handle', { position })}
      aria-roledescription={t('chat.queue.reorder.draggable')}
      className={`pivi-queue-item pivi-sortable-queue-item${dragging ? ' is-dragging' : ''}`}
      data-queue-sort-id={queuedTurn.id}
      onKeyDown={onKeyDown}
      onPointerCancel={reorderHandleProps.onPointerCancel}
      onPointerDown={onPointerDown}
      onPointerMove={reorderHandleProps.onPointerMove}
      onPointerUp={reorderHandleProps.onPointerUp}
      role="listitem"
      style={style}
      tabIndex={total > 1 ? 0 : -1}
    >
      <span className="pivi-queue-indicator-text">{t('chat.queue.queued', { preview: display })}</span>
      <span className="pivi-queue-indicator-actions">
        <button aria-label={t('chat.queue.steer')} className="pivi-queue-indicator-action" onClick={() => actions.steerQueuedTurn(queuedTurn.id)} title={t('chat.queue.steer')} type="button">
          <PlatformIcon name="corner-down-left" />
        </button>
        <button aria-label={t('chat.queue.edit')} className="pivi-queue-indicator-action" onClick={() => actions.editQueuedTurn(queuedTurn.id)} title={t('chat.queue.edit')} type="button">
          <PlatformIcon name="pencil" />
        </button>
        <button aria-label={t('chat.queue.discard')} className="pivi-queue-indicator-action" onClick={() => actions.discardQueuedTurn(queuedTurn.id)} title={t('chat.queue.discard')} type="button">
          <PlatformIcon name="trash-2" />
        </button>
      </span>
    </div>
  );
}

export function QueueIndicator({ queuedTurns, actions }: {
  queuedTurns: readonly QueuedTurnSnapshot[];
  actions: ChatSurfaceActions;
}) {
  const t = useT();
  const [order, setOrder] = useState(() => queuedTurns.map(turn => turn.id));
  const reorder = useSortableReorder<string, HTMLDivElement>({
    order,
    disabled: queuedTurns.length < 2,
    itemSelector: '[data-queue-sort-id]',
    itemDataKey: 'queueSortId',
    setOrder,
    commitOrder: async (ids, originalOrder) => {
      const saved = actions.reorderQueuedTurns(ids);
      if (!saved) setOrder([...originalOrder]);
      return saved;
    },
    positionAnnouncement: (_id, position, total) => t('chat.queue.reorder.position', {
      position,
      total,
    }),
    savedAnnouncement: t('chat.queue.reorder.saved'),
    cancelledAnnouncement: t('chat.queue.reorder.cancelled'),
    failedAnnouncement: t('common.error'),
  });
  useEffect(() => {
    if (reorder.draggingId === null) setOrder(queuedTurns.map(turn => turn.id));
  }, [queuedTurns, reorder.draggingId]);
  if (queuedTurns.length === 0) return null;
  const turnsById = new Map(queuedTurns.map(turn => [turn.id, turn]));
  const orderedTurns = order
    .map(id => turnsById.get(id))
    .filter((turn): turn is QueuedTurnSnapshot => turn !== undefined);
  return (
    <div
      className={`pivi-queue-list${queuedTurns.length > 1 ? ' is-expanded' : ''}`}
      ref={reorder.listRef}
      role="list"
    >
      {orderedTurns.map((queuedTurn, index) => (
        <QueueItem
          actions={actions}
          dragOffset={reorder.draggingId === queuedTurn.id ? reorder.dragOffset : 0}
          dragging={reorder.draggingId === queuedTurn.id}
          key={queuedTurn.id}
          position={index + 1}
          queuedTurn={queuedTurn}
          reorderHandleProps={reorder.getHandleProps(queuedTurn.id)}
          total={orderedTurns.length}
        />
      ))}
      <div aria-live="polite" className="pivi-queue-reorder-announcement">
        {reorder.announcement}
      </div>
    </div>
  );
}

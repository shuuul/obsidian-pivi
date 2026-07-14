import {
  type KeyboardEvent,
  type PointerEvent,
  type RefObject,
  useRef,
  useState,
} from 'react';

const DRAG_THRESHOLD_PX = 8;
const PROVIDER_CARD_SELECTOR = '[data-provider-sort-id]';

interface PointerDrag<ProviderId extends string> {
  readonly id: ProviderId;
  readonly pointerId: number;
  readonly startY: number;
  readonly grabOffset: number;
  readonly originalOrder: readonly ProviderId[];
  active: boolean;
}

interface KeyboardDrag<ProviderId extends string> {
  readonly id: ProviderId;
  readonly originalOrder: readonly ProviderId[];
}

export interface ProviderReorderHandleProps {
  readonly onPointerDown: (event: PointerEvent<HTMLButtonElement>) => void;
  readonly onPointerMove: (event: PointerEvent<HTMLButtonElement>) => void;
  readonly onPointerUp: (event: PointerEvent<HTMLButtonElement>) => void;
  readonly onPointerCancel: (event: PointerEvent<HTMLButtonElement>) => void;
  readonly onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void;
}

interface UseProviderReorderOptions<ProviderId extends string> {
  readonly order: readonly ProviderId[];
  readonly disabled: boolean;
  readonly setOrder: (order: ProviderId[]) => void;
  readonly commitOrder: (order: ProviderId[], originalOrder: readonly ProviderId[]) => Promise<boolean>;
  readonly positionAnnouncement: (id: ProviderId, position: number, total: number) => string;
  readonly savedAnnouncement: string;
  readonly cancelledAnnouncement: string;
  readonly failedAnnouncement: string;
}

interface ProviderReorder<ProviderId extends string> {
  readonly listRef: RefObject<HTMLDivElement>;
  readonly draggingId: ProviderId | null;
  readonly dragOffset: number;
  readonly announcement: string;
  readonly getHandleProps: (id: ProviderId) => ProviderReorderHandleProps;
}

function moveProvider<ProviderId extends string>(
  order: readonly ProviderId[],
  id: ProviderId,
  targetIndex: number,
): ProviderId[] {
  const currentIndex = order.indexOf(id);
  if (currentIndex < 0 || currentIndex === targetIndex) return [...order];
  const next = [...order];
  next.splice(currentIndex, 1);
  next.splice(Math.max(0, Math.min(targetIndex, next.length)), 0, id);
  return next;
}

/** Shared direct-manipulation and keyboard sorting for provider cards. */
export function useProviderReorder<ProviderId extends string>(
  options: UseProviderReorderOptions<ProviderId>,
): ProviderReorder<ProviderId> {
  const [draggingId, setDraggingId] = useState<ProviderId | null>(null);
  const [dragOffset, setDragOffset] = useState(0);
  const [keyboardDrag, setKeyboardDrag] = useState<KeyboardDrag<ProviderId> | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const listRef = useRef<HTMLDivElement>(null);
  const pointerDragRef = useRef<PointerDrag<ProviderId> | null>(null);
  const dragOffsetRef = useRef(0);
  const orderRef = useRef(options.order);
  orderRef.current = options.order;

  const previewOrder = (nextOrder: ProviderId[]): void => {
    orderRef.current = nextOrder;
    options.setOrder(nextOrder);
  };

  const announcePosition = (id: ProviderId, order: readonly ProviderId[]): void => {
    setAnnouncement(options.positionAnnouncement(id, order.indexOf(id) + 1, order.length));
  };

  const onPointerDown = (id: ProviderId, event: PointerEvent<HTMLButtonElement>): void => {
    if (event.button !== 0 || options.disabled || keyboardDrag !== null) return;
    event.preventDefault();
    event.stopPropagation();
    const card = event.currentTarget.closest<HTMLElement>(PROVIDER_CARD_SELECTOR);
    if (!card) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    pointerDragRef.current = {
      id,
      pointerId: event.pointerId,
      startY: event.clientY,
      grabOffset: event.clientY - card.getBoundingClientRect().top,
      originalOrder: [...orderRef.current],
      active: false,
    };
  };

  const onPointerMove = (event: PointerEvent<HTMLButtonElement>): void => {
    const drag = pointerDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (!drag.active && Math.abs(event.clientY - drag.startY) < DRAG_THRESHOLD_PX) return;
    if (!drag.active) {
      drag.active = true;
      setDraggingId(drag.id);
    }

    const card = event.currentTarget.closest<HTMLElement>(PROVIDER_CARD_SELECTOR);
    if (card) {
      const layoutTop = card.getBoundingClientRect().top - dragOffsetRef.current;
      const nextOffset = event.clientY - drag.grabOffset - layoutTop;
      dragOffsetRef.current = nextOffset;
      setDragOffset(nextOffset);
    }

    const elements = Array.from(
      listRef.current?.querySelectorAll<HTMLElement>(PROVIDER_CARD_SELECTOR) ?? [],
    ).filter(element => element.dataset.providerSortId !== drag.id);
    const targetIndex = elements.findIndex((element) => {
      const rect = element.getBoundingClientRect();
      return event.clientY < rect.top + rect.height / 2;
    });
    const currentOrder = orderRef.current;
    const resolvedIndex = targetIndex < 0 ? elements.length : targetIndex;
    const nextOrder = moveProvider(currentOrder, drag.id, resolvedIndex);
    if (nextOrder.some((id, index) => id !== currentOrder[index])) {
      previewOrder(nextOrder);
      announcePosition(drag.id, nextOrder);
    }
  };

  const finishPointerDrag = (event: PointerEvent<HTMLButtonElement>, cancel = false): void => {
    const drag = pointerDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    pointerDragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setDraggingId(null);
    setDragOffset(0);
    dragOffsetRef.current = 0;
    if (!drag.active) return;
    if (cancel) {
      previewOrder([...drag.originalOrder]);
      setAnnouncement(options.cancelledAnnouncement);
      return;
    }
    void options.commitOrder([...orderRef.current], drag.originalOrder).then(
      saved => { setAnnouncement(saved ? options.savedAnnouncement : options.failedAnnouncement); },
      () => { setAnnouncement(options.failedAnnouncement); },
    );
  };

  const onHandleKeyDown = (id: ProviderId, event: KeyboardEvent<HTMLButtonElement>): void => {
    if (options.disabled) return;
    if (event.key === ' ' || event.key === 'Enter') {
      event.preventDefault();
      if (keyboardDrag !== null && keyboardDrag.id !== id) return;
      if (keyboardDrag?.id === id) {
        const nextOrder = [...orderRef.current];
        setKeyboardDrag(null);
        setDraggingId(null);
        void options.commitOrder(nextOrder, keyboardDrag.originalOrder).then(
          saved => { setAnnouncement(saved ? options.savedAnnouncement : options.failedAnnouncement); },
          () => { setAnnouncement(options.failedAnnouncement); },
        );
      } else {
        setKeyboardDrag({ id, originalOrder: [...orderRef.current] });
        setDraggingId(id);
        announcePosition(id, orderRef.current);
      }
      return;
    }
    if (event.key === 'Escape' && keyboardDrag?.id === id) {
      event.preventDefault();
      previewOrder([...keyboardDrag.originalOrder]);
      setKeyboardDrag(null);
      setDraggingId(null);
      setAnnouncement(options.cancelledAnnouncement);
      return;
    }
    if ((event.key === 'ArrowUp' || event.key === 'ArrowDown') && keyboardDrag?.id === id) {
      event.preventDefault();
      const currentOrder = orderRef.current;
      const currentIndex = currentOrder.indexOf(id);
      const nextOrder = moveProvider(
        currentOrder,
        id,
        currentIndex + (event.key === 'ArrowUp' ? -1 : 1),
      );
      previewOrder(nextOrder);
      announcePosition(id, nextOrder);
    }
  };

  return {
    listRef,
    draggingId,
    dragOffset,
    announcement,
    getHandleProps: id => ({
      onPointerDown: event => { onPointerDown(id, event); },
      onPointerMove,
      onPointerUp: event => { finishPointerDrag(event); },
      onPointerCancel: event => { finishPointerDrag(event, true); },
      onKeyDown: event => { onHandleKeyDown(id, event); },
    }),
  };
}

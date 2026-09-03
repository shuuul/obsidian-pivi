import {
  type KeyboardEvent,
  type PointerEvent,
  type RefObject,
  useRef,
  useState,
} from 'react';

const DRAG_THRESHOLD_PX = 8;
const INTERACTIVE_SELECTOR = 'button, input, textarea, select, [contenteditable="true"]';
const SORTABLE_SURFACE_SELECTOR = '[data-sortable-surface]';

function isExcludedPointerTarget(target: EventTarget | null, currentTarget: EventTarget): boolean {
  if (!(target instanceof Element)) return false;
  if (target.closest(SORTABLE_SURFACE_SELECTOR)) return false;
  const interactive = target.closest(INTERACTIVE_SELECTOR);
  return interactive !== null && interactive !== currentTarget;
}

interface PointerDrag<ItemId extends string> {
  readonly id: ItemId;
  readonly pointerId: number;
  readonly captureTarget: Element;
  readonly startY: number;
  readonly originalOrder: readonly ItemId[];
  pendingOrder: ItemId[];
  active: boolean;
}

interface KeyboardDrag<ItemId extends string> {
  readonly id: ItemId;
  readonly originalOrder: readonly ItemId[];
}

export interface SortableReorderHandleProps<Element extends HTMLElement = HTMLButtonElement> {
  readonly onPointerDown: (event: PointerEvent<Element>) => void;
  readonly onPointerMove: (event: PointerEvent<Element>) => void;
  readonly onPointerUp: (event: PointerEvent<Element>) => void;
  readonly onPointerCancel: (event: PointerEvent<Element>) => void;
  readonly onKeyDown: (event: KeyboardEvent<Element>) => void;
}

interface UseSortableReorderOptions<ItemId extends string> {
  readonly order: readonly ItemId[];
  readonly disabled: boolean;
  readonly itemSelector: string;
  readonly itemDataKey: string;
  readonly setOrder: (order: ItemId[]) => void;
  readonly commitOrder: (order: ItemId[], originalOrder: readonly ItemId[]) => Promise<boolean>;
  readonly positionAnnouncement: (
    id: ItemId,
    position: number,
    total: number,
    order: readonly ItemId[],
  ) => string;
  readonly savedAnnouncement: string;
  readonly cancelledAnnouncement: string;
  readonly failedAnnouncement: string;
}

interface SortableReorder<ItemId extends string, Element extends HTMLElement> {
  readonly listRef: RefObject<HTMLDivElement | null>;
  readonly draggingId: ItemId | null;
  readonly dragOffset: number;
  readonly dropIndicator: {
    readonly id: ItemId;
    readonly edge: 'before' | 'after';
  } | null;
  readonly announcement: string;
  readonly getHandleProps: (id: ItemId) => SortableReorderHandleProps<Element>;
  readonly consumeClickAfterDrag: (id: ItemId) => boolean;
}

function moveItem<ItemId extends string>(
  order: readonly ItemId[],
  id: ItemId,
  targetIndex: number,
): ItemId[] {
  const currentIndex = order.indexOf(id);
  if (currentIndex < 0 || currentIndex === targetIndex) return [...order];
  const next = [...order];
  next.splice(currentIndex, 1);
  next.splice(Math.max(0, Math.min(targetIndex, next.length)), 0, id);
  return next;
}

/** Shared direct-manipulation and keyboard sorting for compact ordered lists. */
export function useSortableReorder<
  ItemId extends string,
  Element extends HTMLElement = HTMLButtonElement,
>(
  options: UseSortableReorderOptions<ItemId>,
): SortableReorder<ItemId, Element> {
  const [draggingId, setDraggingId] = useState<ItemId | null>(null);
  const [dragOffset, setDragOffset] = useState(0);
  const [dropIndicator, setDropIndicator] = useState<{
    readonly id: ItemId;
    readonly edge: 'before' | 'after';
  } | null>(null);
  const [keyboardDrag, setKeyboardDrag] = useState<KeyboardDrag<ItemId> | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const listRef = useRef<HTMLDivElement>(null);
  const pointerDragRef = useRef<PointerDrag<ItemId> | null>(null);
  const clickSuppressionRef = useRef<ItemId | null>(null);
  const orderRef = useRef(options.order);
  orderRef.current = options.order;

  const previewOrder = (nextOrder: ItemId[]): void => {
    orderRef.current = nextOrder;
    options.setOrder(nextOrder);
  };

  const announcePosition = (id: ItemId, order: readonly ItemId[]): void => {
    setAnnouncement(options.positionAnnouncement(id, order.indexOf(id) + 1, order.length, order));
  };

  const onPointerDown = (id: ItemId, event: PointerEvent<Element>): void => {
    if (event.button !== 0 || options.disabled || keyboardDrag !== null) return;
    if (isExcludedPointerTarget(event.target, event.currentTarget)) return;
    event.stopPropagation();
    const item = event.currentTarget.closest<HTMLElement>(options.itemSelector);
    if (!item) return;
    const captureTarget = event.target instanceof Element
      ? event.target.closest(SORTABLE_SURFACE_SELECTOR) ?? event.currentTarget
      : event.currentTarget;
    captureTarget.setPointerCapture(event.pointerId);
    pointerDragRef.current = {
      id,
      pointerId: event.pointerId,
      captureTarget,
      startY: event.clientY,
      originalOrder: [...orderRef.current],
      pendingOrder: [...orderRef.current],
      active: false,
    };
  };

  const onPointerMove = (event: PointerEvent<Element>): void => {
    const drag = pointerDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (!drag.active && Math.abs(event.clientY - drag.startY) < DRAG_THRESHOLD_PX) return;
    event.preventDefault();
    if (!drag.active) {
      drag.active = true;
      setDraggingId(drag.id);
    }
    setDragOffset(event.clientY - drag.startY);

    const elements = Array.from(
      listRef.current?.querySelectorAll<HTMLElement>(options.itemSelector) ?? [],
    ).filter(element => element.dataset[options.itemDataKey] !== drag.id);
    const targetIndex = elements.findIndex((element) => {
      const rect = element.getBoundingClientRect();
      return event.clientY < rect.top + rect.height / 2;
    });
    const resolvedIndex = targetIndex < 0 ? elements.length : targetIndex;
    const nextOrder = moveItem(drag.originalOrder, drag.id, resolvedIndex);
    if (nextOrder.some((id, index) => id !== drag.pendingOrder[index])) {
      drag.pendingOrder = nextOrder;
      announcePosition(drag.id, nextOrder);
    }
    const indicatorElement = elements[resolvedIndex] ?? elements.at(-1);
    const indicatorId = indicatorElement?.dataset[options.itemDataKey] as ItemId | undefined;
    setDropIndicator(indicatorId
      ? { id: indicatorId, edge: resolvedIndex < elements.length ? 'before' : 'after' }
      : null);
  };

  const finishPointerDrag = (event: PointerEvent<Element>, cancel = false): void => {
    const drag = pointerDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    pointerDragRef.current = null;
    if (drag.captureTarget.hasPointerCapture(event.pointerId)) {
      drag.captureTarget.releasePointerCapture(event.pointerId);
    }
    setDraggingId(null);
    setDragOffset(0);
    setDropIndicator(null);
    if (!drag.active) return;
    if (cancel) {
      setAnnouncement(options.cancelledAnnouncement);
      return;
    }
    clickSuppressionRef.current = drag.id;
    event.currentTarget.ownerDocument.defaultView?.setTimeout(() => {
      if (clickSuppressionRef.current === drag.id) clickSuppressionRef.current = null;
    }, 0);
    previewOrder([...drag.pendingOrder]);
    void options.commitOrder([...drag.pendingOrder], drag.originalOrder).then(
      saved => { setAnnouncement(saved ? options.savedAnnouncement : options.failedAnnouncement); },
      () => { setAnnouncement(options.failedAnnouncement); },
    );
  };

  const onHandleKeyDown = (id: ItemId, event: KeyboardEvent<Element>): void => {
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
      const nextOrder = moveItem(
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
    dropIndicator,
    announcement,
    consumeClickAfterDrag: (id) => {
      if (clickSuppressionRef.current !== id) return false;
      clickSuppressionRef.current = null;
      return true;
    },
    getHandleProps: id => ({
      onPointerDown: event => { onPointerDown(id, event); },
      onPointerMove,
      onPointerUp: event => { finishPointerDrag(event); },
      onPointerCancel: event => { finishPointerDrag(event, true); },
      onKeyDown: event => { onHandleKeyDown(id, event); },
    }),
  };
}

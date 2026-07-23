import type { CSSProperties, KeyboardEvent, PointerEvent } from 'react';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';

import { useT } from '../../i18n';
import { PlatformIcon } from '../../icons';
import { usePresentationPlatform } from '../../platform';
import {
  type SortableReorderHandleProps,
  useSortableReorder,
} from '../../reorder/useSortableReorder';
import type { ChatTabSnapshotItem } from '../../store';
import type { ChatShellOptions } from '../types';
import { ActiveTabTitle } from './ActiveTabTitle';
import {
  ARCHIVED_REVEAL_THRESHOLD,
  EXIT_DURATION_MS,
  MENU_CLOSE_DURATION_MS,
  TAB_SWITCHER_ITEM_HEIGHT_PX,
  TAB_SWITCHER_MENU_CHROME_HEIGHT_PX,
  TAB_SWITCHER_VISIBLE_ITEM_COUNT,
  TOOLTIP_DELAY_MS,
} from './constants';
import { EditableTabTitle } from './EditableTabTitle';
import { TabAction } from './TabAction';
import { dotClass, getFallbackItem } from './tabUtils';

const ARCHIVED_BOUNDARY_ID = '__pivi_archived_tabs_boundary__';

function buildTabOrder(items: readonly ChatTabSnapshotItem[]): string[] {
  return [
    ...items.filter(item => !item.isArchived).map(item => item.id),
    ARCHIVED_BOUNDARY_ID,
    ...items.filter(item => item.isArchived).map(item => item.id),
  ];
}

function splitTabOrder(order: readonly string[]): {
  openIds: string[];
  archivedIds: string[];
} {
  const boundaryIndex = order.indexOf(ARCHIVED_BOUNDARY_ID);
  if (boundaryIndex < 0) return { openIds: [], archivedIds: [] };
  return {
    openIds: order.slice(0, boundaryIndex),
    archivedIds: order.slice(boundaryIndex + 1),
  };
}

export function ChatTabBar({ shell, ownerWindow }: { shell: ChatShellOptions; ownerWindow: Window }) {
  const platform = usePresentationPlatform();
  const snapshot = useSyncExternalStore(
    shell.store.subscribe,
    shell.store.getSnapshot,
    shell.store.getSnapshot,
  );
  const t = useT();
  const containerRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLSpanElement>(null);
  const exitTimers = useRef(new Map<string, number>());
  const menuCloseTimer = useRef<number | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const [editingTabId, setEditingTabId] = useState<string | null>(null);
  const [exitingTabIds, setExitingTabIds] = useState<ReadonlySet<string>>(new Set());
  const [, setArchivedRevealProgress] = useState(0);
  const [isArchivedRevealed, setIsArchivedRevealed] = useState(false);
  const [focusMenuOnOpen, setFocusMenuOnOpen] = useState(false);
  const [tabOrder, setTabOrder] = useState(() => buildTabOrder(snapshot.items));
  const itemsById = useMemo(
    () => new Map(snapshot.items.map(item => [item.id, item])),
    [snapshot.items],
  );
  const reorder = useSortableReorder<string, HTMLDivElement>({
    order: tabOrder,
    disabled: editingTabId !== null || exitingTabIds.size > 0,
    itemSelector: '[data-tab-sort-id]',
    itemDataKey: 'tabSortId',
    setOrder: setTabOrder,
    commitOrder: async (order, originalOrder) => {
      const { openIds, archivedIds } = splitTabOrder(order);
      const saved = await shell.actions.reorderTabs(openIds, archivedIds);
      if (!saved) setTabOrder([...originalOrder]);
      return saved;
    },
    positionAnnouncement: (id, _position, _total, order) => {
      const { openIds, archivedIds } = splitTabOrder(order);
      const groupIds = archivedIds.includes(id) ? archivedIds : openIds;
      return t('chat.tabs.reorder.position', {
        group: t(archivedIds.includes(id) ? 'chat.tabs.archived' : 'chat.tabs.active'),
        position: groupIds.indexOf(id) + 1,
        total: groupIds.length,
      });
    },
    savedAnnouncement: t('chat.tabs.reorder.saved'),
    cancelledAnnouncement: t('chat.tabs.reorder.cancelled'),
    failedAnnouncement: t('chat.tabs.reorder.failed'),
  });
  const { openIds } = splitTabOrder(tabOrder);
  const openItems = openIds
    .map(id => itemsById.get(id))
    .filter((item): item is ChatTabSnapshotItem => item !== undefined);
  const openItemsRef = useRef(openItems);
  openItemsRef.current = openItems;
  useEffect(() => {
    if (reorder.draggingId === null) setTabOrder(buildTabOrder(snapshot.items));
  }, [reorder.draggingId, snapshot.items]);

  useEffect(() => {
    if (reorder.draggingId !== null) setIsArchivedRevealed(true);
  }, [reorder.draggingId]);

  const closeMenu = useCallback((): void => {
    setEditingTabId(null);
    if (!isOpen) return;
    setIsOpen(false);
    setIsClosing(true);
    if (menuCloseTimer.current !== null) ownerWindow.clearTimeout(menuCloseTimer.current);
    menuCloseTimer.current = ownerWindow.setTimeout(() => {
      menuCloseTimer.current = null;
      setIsClosing(false);
    }, MENU_CLOSE_DURATION_MS);
  }, [isOpen, ownerWindow]);

  useEffect(() => () => {
    if (menuCloseTimer.current !== null) ownerWindow.clearTimeout(menuCloseTimer.current);
    for (const timer of exitTimers.current.values()) ownerWindow.clearTimeout(timer);
    exitTimers.current.clear();
  }, [ownerWindow]);

  useEffect(() => {
    const close = (): void => closeMenu();
    ownerWindow.document.addEventListener('click', close);
    return () => ownerWindow.document.removeEventListener('click', close);
  }, [closeMenu, ownerWindow]);

  useEffect(() => {
    if (!isOpen || !focusMenuOnOpen) return;
    setFocusMenuOnOpen(false);
    const menuItems = Array.from(
      containerRef.current?.querySelectorAll<HTMLElement>('.pivi-tab-switcher-item') ?? [],
    );
    (menuItems.find(item => item.classList.contains('is-active')) ?? menuItems[0])?.focus();
  }, [focusMenuOnOpen, isOpen]);

  useEffect(() => {
    const menu = menuRef.current;
    const items = openItemsRef.current;
    if (!menu || !isOpen || items.length <= TAB_SWITCHER_VISIBLE_ITEM_COUNT) return;
    const activeIndex = items.findIndex(item => item.isActive);
    if (activeIndex < 0) return;
    const centeredStart = activeIndex - Math.floor(TAB_SWITCHER_VISIBLE_ITEM_COUNT / 2);
    const windowStart = Math.max(
      0,
      Math.min(centeredStart, items.length - TAB_SWITCHER_VISIBLE_ITEM_COUNT),
    );
    menu.scrollTop = windowStart * TAB_SWITCHER_ITEM_HEIGHT_PX;
  }, [isOpen]);

  useEffect(() => {
    const menu = menuRef.current;
    if (!menu || !isOpen || isArchivedRevealed || !snapshot.items.some(item => item.isArchived)) {
      return;
    }
    const handleWheel = (event: WheelEvent): void => {
      if (event.deltaY <= 0) return;
      event.preventDefault();
      setArchivedRevealProgress((current) => {
        const next = current + event.deltaY;
        if (next < ARCHIVED_REVEAL_THRESHOLD) return next;
        setIsArchivedRevealed(true);
        return 0;
      });
    };
    menu.addEventListener('wheel', handleWheel, { passive: false });
    return () => menu.removeEventListener('wheel', handleWheel);
  }, [isArchivedRevealed, isOpen, snapshot.items]);

  const activeItem = snapshot.items.find(item => item.isActive) ?? snapshot.items[0];
  if (!activeItem) return null;

  const openMenu = (focus: boolean): void => {
    if (menuCloseTimer.current !== null) ownerWindow.clearTimeout(menuCloseTimer.current);
    menuCloseTimer.current = null;
    setIsClosing(false);
    setArchivedRevealProgress(0);
    setIsArchivedRevealed(false);
    setFocusMenuOnOpen(focus);
    setIsOpen(true);
  };

  const beginExit = (item: ChatTabSnapshotItem, action: 'archive' | 'close'): void => {
    if (exitingTabIds.has(item.id) || exitTimers.current.has(item.id)) return;
    if (item.isActive) {
      const fallback = getFallbackItem(snapshot.items, item.id);
      if (fallback) void shell.actions.switchTab(fallback.id);
    }
    setExitingTabIds(current => new Set(current).add(item.id));
    const timer = ownerWindow.setTimeout(() => {
      exitTimers.current.delete(item.id);
      const rows = Array.from(
        containerRef.current?.querySelectorAll<HTMLElement>('.pivi-tab-switcher-item') ?? [],
      );
      const exitingRow = rows.find(row => row.dataset.tabId === item.id) ?? null;
      if (exitingRow?.contains(ownerWindow.document.activeElement)) {
        const index = rows.indexOf(exitingRow);
        const isVisible = (row: HTMLElement): boolean => (
          row !== exitingRow
          && !row.classList.contains('is-exiting')
          && (isArchivedRevealed || !row.classList.contains('is-archived'))
        );
        const next = rows.slice(index + 1).find(isVisible)
          ?? rows.slice(0, index).reverse().find(isVisible);
        (next ?? triggerRef.current)?.focus();
      }
      setExitingTabIds(current => {
        const next = new Set(current);
        next.delete(item.id);
        return next;
      });
      if (action === 'archive') void shell.actions.archiveTab(item.id);
      else void shell.actions.closeTab(item.id);
    }, EXIT_DURATION_MS);
    exitTimers.current.set(item.id, timer);
  };

  const focusAdjacent = (element: HTMLElement, direction: 1 | -1): void => {
    const items = Array.from(
      containerRef.current?.querySelectorAll<HTMLElement>('.pivi-tab-switcher-item') ?? [],
    ).filter(item => (
      !item.classList.contains('is-exiting')
      && (isArchivedRevealed || !item.classList.contains('is-archived'))
      && !item.hidden
      && ownerWindow.getComputedStyle(item).display !== 'none'
      && ownerWindow.getComputedStyle(item).visibility !== 'hidden'
    ));
    if (items.length === 0) return;
    const index = items.indexOf(element);
    items[(index + direction + items.length) % items.length]?.focus();
  };

  const handleItemKeyDown = (
    event: KeyboardEvent<HTMLDivElement>,
    item: ChatTabSnapshotItem,
    reorderHandleProps: SortableReorderHandleProps<HTMLDivElement>,
  ): void => {
    if (event.target !== event.currentTarget) return;
    if (event.key === ' ' || reorder.draggingId === item.id) {
      reorderHandleProps.onKeyDown(event);
      if (event.defaultPrevented) return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      event.stopPropagation();
      focusAdjacent(event.currentTarget, event.key === 'ArrowDown' ? 1 : -1);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      closeMenu();
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      event.stopPropagation();
      if (exitingTabIds.has(item.id)) return;
      if (!item.isArchived) closeMenu();
      void shell.actions.switchTab(item.id);
    }
  };

  const menuStyle = {
    maxHeight: `${
      TAB_SWITCHER_VISIBLE_ITEM_COUNT * TAB_SWITCHER_ITEM_HEIGHT_PX
      + TAB_SWITCHER_MENU_CHROME_HEIGHT_PX
    }px`,
  } as CSSProperties;
  const archivedBoundaryIndex = tabOrder.indexOf(ARCHIVED_BOUNDARY_ID);

  const renderItem = (item: ChatTabSnapshotItem, previewArchived: boolean) => {
    const editing = editingTabId === item.id;
    const exiting = exitingTabIds.has(item.id);
    const dragging = reorder.draggingId === item.id;
    const reorderHandleProps = reorder.getHandleProps(item.id);
    const style = dragging
      ? { '--pivi-tab-drag-y': `${reorder.dragOffset}px` } as CSSProperties
      : undefined;
    const handlePointerDown = (event: PointerEvent<HTMLDivElement>): void => {
      if (
        editing
        || exiting
        || (event.target as Element).closest('button, input, [role="button"], [contenteditable="true"]')
      ) return;
      reorderHandleProps.onPointerDown(event);
    };
    return (
      <div
        aria-label={item.title}
        aria-roledescription={t('chat.tabs.reorder.draggable')}
        className={`pivi-tab-switcher-item pivi-sortable-tab-item${item.isActive ? ' is-active' : ''}${item.needsAttention ? ' needs-attention' : ''}${previewArchived ? ' is-archived' : ''}${exiting ? ' is-exiting' : ''}${editing ? ' is-editing' : ''}${dragging ? ' is-dragging' : ''}`}
        data-tab-id={item.id}
        data-tab-sort-id={item.id}
        key={item.id}
        onClick={(event) => {
          event.stopPropagation();
          if (reorder.consumeClickAfterDrag(item.id)) return;
          if (editing || exiting) return;
          if (!previewArchived) closeMenu();
          void shell.actions.switchTab(item.id);
        }}
        onKeyDown={event => handleItemKeyDown(event, item, reorderHandleProps)}
        onPointerCancel={reorderHandleProps.onPointerCancel}
        onPointerDown={handlePointerDown}
        onPointerMove={reorderHandleProps.onPointerMove}
        onPointerUp={reorderHandleProps.onPointerUp}
        role="menuitem"
        ref={(element) => {
          if (element) {
            platform.attachTooltip(element, item.title, { delay: TOOLTIP_DELAY_MS });
          }
        }}
        style={style}
        tabIndex={0}
      >
        <span className={`pivi-tab-switcher-dot${dotClass(item)}`} />
        <span className="pivi-tab-switcher-item-title">
          {editing
            ? (
              <EditableTabTitle
                item={item}
                onCancel={() => setEditingTabId(null)}
                onSubmit={(title) => {
                  setEditingTabId(null);
                  if (title && title !== item.title) void shell.actions.renameTab(item.id, title);
                }}
              />
            )
            : item.title}
        </span>
        <TabAction
          className="pivi-tab-switcher-action pivi-tab-switcher-edit-title"
          icon="pencil"
          label={t('chat.tabs.editTitle', { title: item.title })}
          onActivate={() => {
            if (!exiting) setEditingTabId(item.id);
          }}
        />
        <TabAction
          className="pivi-tab-switcher-action pivi-tab-switcher-archive"
          icon={previewArchived ? 'archive-restore' : 'archive'}
          label={t(previewArchived ? 'chat.tabs.restoreTab' : 'chat.tabs.archiveTab', {
            title: item.title,
          })}
          onActivate={() => {
            if (previewArchived) {
              void shell.actions.switchTab(item.id);
            } else {
              beginExit(item, 'archive');
            }
          }}
        />
        {item.canClose
          ? (
            <TabAction
              className="pivi-tab-switcher-action pivi-tab-switcher-close"
              icon="x"
              label={t('chat.tabs.closeTab', { title: item.title })}
              onActivate={() => beginExit(item, 'close')}
            />
          )
          : null}
      </div>
    );
  };

  return (
    <div className={`pivi-tab-switcher${isOpen ? ' is-open' : ''}`} ref={containerRef}>
      {isOpen || isClosing
        ? (
          <div
            className={`pivi-tab-switcher-menu${isArchivedRevealed ? ' is-archived-revealed' : ''}${isClosing ? ' is-closing' : ''}`}
            onClick={event => event.stopPropagation()}
            ref={menuRef}
            role="menu"
            style={menuStyle}
          >
            <div className="pivi-tab-sort-list" ref={reorder.listRef} role="presentation">
              {tabOrder.map((id, index) => {
                if (id === ARCHIVED_BOUNDARY_ID) {
                  return (
                    <div
                      className="pivi-tab-switcher-section-label"
                      data-tab-sort-id={ARCHIVED_BOUNDARY_ID}
                      key={ARCHIVED_BOUNDARY_ID}
                    >
                      {t('chat.tabs.archived')}
                    </div>
                  );
                }
                const item = itemsById.get(id);
                return item
                  ? renderItem(item, archivedBoundaryIndex >= 0 && index > archivedBoundaryIndex)
                  : null;
              })}
            </div>
          </div>
        )
        : null}
      <div className="pivi-tab-switcher-control">
        <TabAction
          className="pivi-tab-switcher-new-chat"
          icon="square-pen"
          label={t('chat.tabs.startNewChat')}
          onActivate={() => {
            closeMenu();
            void shell.actions.startNewChat();
          }}
        />
        <span
          aria-expanded={isOpen}
          aria-haspopup="menu"
          aria-label={t('chat.tabs.switchTab', { title: activeItem.title })}
          className="pivi-tab-switcher-trigger"
          onClick={(event) => {
            event.stopPropagation();
            if (isOpen) closeMenu();
            else openMenu(false);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              event.stopPropagation();
              if (isOpen) closeMenu();
              else openMenu(true);
            } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault();
              event.stopPropagation();
              openMenu(true);
            } else if (event.key === 'Escape' && isOpen) {
              event.preventDefault();
              closeMenu();
            }
          }}
          ref={(element) => {
            triggerRef.current = element;
            if (element) {
              platform.attachTooltip(element, t('chat.tabs.switchTab', { title: activeItem.title }), {
                delay: TOOLTIP_DELAY_MS,
              });
            }
          }}
          role="button"
          tabIndex={0}
        >
          <span className={`pivi-tab-switcher-dot${dotClass(activeItem)}`} />
          <ActiveTabTitle item={activeItem} ownerWindow={ownerWindow} />
          <span className="pivi-tab-switcher-chevron"><PlatformIcon name="chevron-up" /></span>
        </span>
      </div>
      <div aria-live="polite" className="pivi-visually-hidden">{reorder.announcement}</div>
    </div>
  );
}

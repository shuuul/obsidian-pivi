import type { ChatIconSvg, ChatMessage, ChatSvgChild, UsageInfo } from '@pivi/pivi-agent-core/foundation';
import { calculateInputUsagePercentage } from '@pivi/pivi-agent-core/foundation/usage';
import { setTooltip } from 'obsidian';
import {
  type CSSProperties,
  Fragment,
  type KeyboardEvent,
  type MouseEvent,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { createPortal } from 'react-dom';

import type { MessagePresentationActions } from '../chat/messages';
import { MessageList } from '../chat/messages';
import { useT } from '../i18n';
import { ObsidianIcon } from '../icons';
import type {
  ChatTabActions,
  ChatTabSnapshotItem,
  ChatTabsStore,
  ChatUiSnapshot,
  ComposerOptionSnapshot,
  DeepReadonly,
  QueuedTurnSnapshot,
} from '../store';
import { formatCompactTokenCount } from '../usage/usageInfo';
import type { ActiveChatUiBridge, ComposerChromeActions } from './activeChatUiBridge';
import { ModelOptionIcon } from './ModelOptionIcon';

const EXIT_DURATION_MS = 200;
const TITLE_SCROLL_DURATION_MS = 180;
const MENU_CLOSE_DURATION_MS = 280;
const ARCHIVED_REVEAL_THRESHOLD = 80;
const TOOLTIP_DELAY_MS = 3000;

export interface ChatSurfaceActions {
  editQueuedTurn: () => void;
  discardQueuedTurn: () => void;
  scrollToTop: () => void;
  scrollToPreviousUserMessage: () => void;
  scrollToNextUserMessage: () => void;
  scrollToBottom: () => void;
  resumeAutoScroll: () => void;
}

export interface WelcomeQuoteAdapter {
  mount: (container: HTMLElement) => () => void;
}

export interface ChatShellOptions {
  store: ChatTabsStore;
  actions: ChatTabActions;
  inputPortalContainer: HTMLElement;
  activeChat?: ActiveChatUiBridge;
  surfaceActions?: ChatSurfaceActions;
  welcomeQuoteAdapter?: WelcomeQuoteAdapter;
}

const EMPTY_SURFACE_ACTIONS: ChatSurfaceActions = {
  editQueuedTurn: () => {},
  discardQueuedTurn: () => {},
  scrollToTop: () => {},
  scrollToPreviousUserMessage: () => {},
  scrollToNextUserMessage: () => {},
  scrollToBottom: () => {},
  resumeAutoScroll: () => {},
};

const EMPTY_MESSAGE_ACTIONS: MessagePresentationActions = {
  canCopy: () => false,
  canFork: () => false,
  canRedo: () => false,
  copy: () => {},
  fork: () => {},
  redo: () => {},
  scrollToRecentUser: () => {},
};

function renderSvgChild(child: ChatSvgChild, key: number) {
  if (child.tag === 'g') {
    return (
      <g key={key} {...child.attributes}>
        {child.children.map((nested, index) => renderSvgChild(nested, index))}
      </g>
    );
  }
  return <path key={key} {...child.attributes} />;
}

function ChatLogo({ icon }: { icon: ChatIconSvg | null }) {
  const generatedId = useId().replace(/:/g, '');
  if (!icon) return null;
  if (icon.kind === 'pivi-brand') {
    const maskId = `pivi-brand-cutout-${generatedId}`;
    return (
      <svg aria-hidden="true" className="pivi-brand-icon" fill="none" viewBox="0 0 100 100">
        <defs>
          <mask id={maskId}>
            <rect fill="black" height="100" width="100" />
            <rect fill="white" height="72" rx="9" width="18" x="23" y="14" />
            <g transform="rotate(18 56 35)">
              <ellipse cx="56" cy="35" fill="white" rx="31" ry="25" />
            </g>
            <g transform="rotate(-20 58 36)">
              <ellipse cx="58" cy="36" fill="black" rx="14" ry="11" />
            </g>
          </mask>
        </defs>
        <rect fill="currentColor" height="100" mask={`url(#${maskId})`} width="100" />
      </svg>
    );
  }
  return (
    <svg
      aria-hidden="true"
      className="pivi-brand-icon pivi-provider-icon"
      fill="none"
      height="18"
      viewBox={icon.viewBox}
      width="18"
    >
      {icon.kind === 'composite'
        ? icon.children.map((child, index) => renderSvgChild(child, index))
        : <path d={icon.path} fill="currentColor" />}
    </svg>
  );
}

function useTooltip(label: string) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (ref.current) setTooltip(ref.current, label, { delay: TOOLTIP_DELAY_MS });
  }, [label]);
  return ref;
}

function TabAction({
  className,
  icon,
  label,
  onActivate,
}: {
  className: string;
  icon: string;
  label: string;
  onActivate: () => void;
}) {
  const ref = useTooltip(label);
  const activate = (event: MouseEvent | KeyboardEvent): void => {
    event.stopPropagation();
    if ('key' in event && event.key !== 'Enter' && event.key !== ' ') return;
    if ('key' in event) event.preventDefault();
    onActivate();
  };
  return (
    <span
      aria-label={label}
      className={className}
      onClick={activate}
      onKeyDown={activate}
      ref={ref}
      role="button"
      tabIndex={0}
    >
      <ObsidianIcon name={icon} />
    </span>
  );
}

function dotClass(item: ChatTabSnapshotItem): string {
  if (item.isStreaming) return ' is-live';
  if (item.needsAttention) return ' is-unread';
  return '';
}

function ActiveTabTitle({ item, ownerWindow }: {
  item: ChatTabSnapshotItem;
  ownerWindow: Window;
}) {
  const [displayedTitle, setDisplayedTitle] = useState(item.title);
  const [scrollClass, setScrollClass] = useState('');
  const previous = useRef({ id: item.id, index: item.index, title: item.title });

  useEffect(() => {
    const prior = previous.current;
    if (prior.id === item.id && prior.index === item.index && prior.title === item.title) return;
    const direction = prior.id === item.id || item.index >= prior.index
      ? 'is-scrolling-up'
      : 'is-scrolling-down';
    previous.current = { id: item.id, index: item.index, title: item.title };
    setScrollClass(direction);
    const timer = ownerWindow.setTimeout(() => {
      setDisplayedTitle(item.title);
      setScrollClass('');
    }, TITLE_SCROLL_DURATION_MS);
    return () => ownerWindow.clearTimeout(timer);
  }, [item.id, item.index, item.title, ownerWindow]);

  return (
    <span className={`pivi-tab-switcher-title${scrollClass ? ` ${scrollClass}` : ''}`}>
      {displayedTitle}
    </span>
  );
}

function EditableTabTitle({
  item,
  onCancel,
  onSubmit,
}: {
  item: ChatTabSnapshotItem;
  onCancel: () => void;
  onSubmit: (title: string) => void;
}) {
  const t = useT();
  const inputRef = useRef<HTMLInputElement>(null);
  const cancelled = useRef(false);
  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.focus({ preventScroll: true });
    input.setSelectionRange(input.value.length, input.value.length);
    input.scrollLeft = input.scrollWidth;
  }, []);

  return (
    <input
      aria-label={t('chat.tabs.editTitleInputLabel')}
      className="pivi-tab-switcher-title-input"
      defaultValue={item.title}
      onBlur={(event) => {
        if (cancelled.current) return;
        onSubmit(event.currentTarget.value.trim());
      }}
      onClick={event => event.stopPropagation()}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === 'Escape') {
          event.preventDefault();
          cancelled.current = true;
          onCancel();
        } else if (event.key === 'Enter') {
          event.preventDefault();
          event.currentTarget.blur();
        }
      }}
      ref={inputRef}
    />
  );
}

function getFallbackItem(items: readonly ChatTabSnapshotItem[], tabId: string) {
  const openItems = items.filter(item => !item.isArchived);
  const openIndex = openItems.findIndex(item => item.id === tabId);
  if (openIndex >= 0) return openItems[openIndex - 1] ?? openItems[openIndex + 1] ?? null;
  const index = items.findIndex(item => item.id === tabId);
  return items[index - 1] ?? items[index + 1] ?? null;
}

function ChatTabBar({ shell, ownerWindow }: { shell: ChatShellOptions; ownerWindow: Window }) {
  const snapshot = useSyncExternalStore(
    shell.store.subscribe,
    shell.store.getSnapshot,
    shell.store.getSnapshot,
  );
  const t = useT();
  const containerRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const exitTimers = useRef(new Map<string, number>());
  const menuCloseTimer = useRef<number | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const [editingTabId, setEditingTabId] = useState<string | null>(null);
  const [exitingTabIds, setExitingTabIds] = useState<ReadonlySet<string>>(new Set());
  const [, setArchivedRevealProgress] = useState(0);
  const [isArchivedRevealed, setIsArchivedRevealed] = useState(false);
  const [focusMenuOnOpen, setFocusMenuOnOpen] = useState(false);

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
    );
    if (items.length === 0) return;
    const index = items.indexOf(element);
    items[(index + direction + items.length) % items.length]?.focus();
  };

  const handleItemKeyDown = (event: KeyboardEvent<HTMLDivElement>, item: ChatTabSnapshotItem): void => {
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
      closeMenu();
      void shell.actions.switchTab(item.id);
    }
  };

  const openItems = snapshot.items.filter(item => !item.isArchived);
  const archivedItems = snapshot.items.filter(item => item.isArchived);
  const menuStyle = {
    '--pivi-tab-menu-open-height': `${Math.max(1, openItems.length) * 28}px`,
  } as CSSProperties;

  const renderItem = (item: ChatTabSnapshotItem) => {
    const editing = editingTabId === item.id;
    const exiting = exitingTabIds.has(item.id);
    return (
      <div
        aria-label={item.title}
        className={`pivi-tab-switcher-item${item.isActive ? ' is-active' : ''}${item.needsAttention ? ' needs-attention' : ''}${item.isArchived ? ' is-archived' : ''}${exiting ? ' is-exiting' : ''}${editing ? ' is-editing' : ''}`}
        data-tab-id={item.id}
        key={item.id}
        onClick={(event) => {
          event.stopPropagation();
          if (editing || exiting) return;
          closeMenu();
          void shell.actions.switchTab(item.id);
        }}
        onKeyDown={event => handleItemKeyDown(event, item)}
        role="menuitem"
        ref={(element) => {
          if (element) setTooltip(element, item.title, { delay: TOOLTIP_DELAY_MS });
        }}
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
          icon={item.isArchived ? 'archive-restore' : 'archive'}
          label={t(item.isArchived ? 'chat.tabs.restoreTab' : 'chat.tabs.archiveTab', {
            title: item.title,
          })}
          onActivate={() => {
            if (item.isArchived) {
              closeMenu();
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
            {openItems.map(renderItem)}
            {archivedItems.length > 0
              ? <div className="pivi-tab-switcher-section-label">{t('chat.tabs.archived')}</div>
              : null}
            {archivedItems.map(renderItem)}
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
            if (element) {
              setTooltip(element, t('chat.tabs.switchTab', { title: activeItem.title }), {
                delay: TOOLTIP_DELAY_MS,
              });
            }
          }}
          role="button"
          tabIndex={0}
        >
          <span className={`pivi-tab-switcher-dot${dotClass(activeItem)}`} />
          <ActiveTabTitle item={activeItem} ownerWindow={ownerWindow} />
          <span className="pivi-tab-switcher-chevron"><ObsidianIcon name="chevron-up" /></span>
        </span>
      </div>
    </div>
  );
}

function WelcomeSurface({ greeting, quoteAdapter }: {
  greeting: string | null;
  quoteAdapter?: WelcomeQuoteAdapter;
}) {
  const quoteRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const quoteContainer = quoteRef.current;
    return quoteContainer && quoteAdapter ? quoteAdapter.mount(quoteContainer) : undefined;
  }, [greeting, quoteAdapter]);

  if (!greeting) return null;
  return (
    <div className="pivi-welcome">
      <div className="pivi-welcome-quote-adapter" ref={quoteRef} />
      <div className="pivi-welcome-greeting">{greeting}</div>
    </div>
  );
}

function QueueIndicator({ queuedTurn, actions }: {
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
          <ObsidianIcon name="pencil" />
        </button>
        <button aria-label={t('chat.queue.discard')} className="pivi-queue-indicator-icon-action" onClick={actions.discardQueuedTurn} type="button">
          <ObsidianIcon name="trash-2" />
        </button>
      </span>
    </div>
  );
}

function UsageMeter({ usage }: { usage: UsageInfo | null }) {
  const t = useT();
  // Composer meter is input-only: one ring for inputTokens / contextWindow (no output ring).
  const inputTokens = usage?.inputTokens ?? 0;
  const inputLimit = usage?.contextWindow ?? 0;
  const inputPercentage = usage ? calculateInputUsagePercentage(usage) : 0;
  if (!(inputTokens > 0 && inputLimit > 0)) return null;
  const label = t('chat.usage.input', {
    tokens: formatCompactTokenCount(inputTokens),
    limit: formatCompactTokenCount(inputLimit),
    percentage: inputPercentage,
  });
  return (
    <div className="pivi-context-meter">
      <span
        aria-label={label}
        className={`pivi-context-meter-gauge pivi-context-meter-gauge-input${inputPercentage > 80 ? ' warning' : ''}`}
        data-tooltip={label}
      >
        <svg aria-hidden="true" height="16" viewBox="0 0 16 16" width="16">
          <path className="pivi-meter-bg" d="M 1.94 11.5 A 7 7 0 1 1 14.06 11.5" fill="none" strokeLinecap="round" strokeWidth="2" />
          <path
            className="pivi-meter-fill pivi-meter-fill-input"
            d="M 1.94 11.5 A 7 7 0 1 1 14.06 11.5"
            fill="none"
            pathLength="100"
            strokeDasharray="100"
            strokeDashoffset={100 - inputPercentage}
            strokeLinecap="round"
            strokeWidth="2"
          />
        </svg>
      </span>
    </div>
  );
}

function TodoSurface({ model }: {
  model: ChatUiSnapshot['currentTodoVisualizationModel'];
}) {
  const t = useT();
  const [expanded, setExpanded] = useState(true);
  if (!model || model.items.length === 0) return null;
  const active = model.items.find(item => item.id === model.activeItemId);
  const progressParams = {
    completed: model.progress.completed,
    total: model.progress.total,
  };
  return (
    <div className="pivi-status-panel pivi-status-panel-todos">
      <button
        aria-expanded={expanded}
        aria-label={t(expanded ? 'chat.todos.collapse' : 'chat.todos.expand', progressParams)}
        className="pivi-status-panel-header"
        onClick={() => setExpanded(value => !value)}
        type="button"
      >
        <span className="pivi-status-panel-icon"><ObsidianIcon name="list-todo" /></span>
        <span className="pivi-status-panel-label">{t('chat.todos.progress', progressParams)}</span>
        {!expanded && active ? <span className="pivi-status-panel-current">{active.activeForm ?? active.content}</span> : null}
        {!expanded && model.progress.completed === model.progress.total ? <span className="pivi-status-panel-status status-completed"><ObsidianIcon name="check" /></span> : null}
      </button>
      {expanded ? (
        <div className="pivi-status-panel-content pivi-todo-panel" data-pivi-todo-source={model.source}>
          <div className="pivi-todo-panel-progress">
            <div className="pivi-todo-progress-summary">{t('chat.todos.progress', progressParams)}</div>
            <div className="pivi-todo-progress-meter"><div className="pivi-todo-progress-fill" style={{ width: `${model.progress.total ? (model.progress.completed / model.progress.total) * 100 : 0}%` }} /></div>
          </div>
          <div className="pivi-todo-panel-list pivi-todo-list-container">
            {model.items.map(item => (
              <div className={`pivi-todo-item pivi-todo-${item.status}`} key={item.id}>
                <span aria-hidden="true" className="pivi-todo-status-icon"><ObsidianIcon name={item.status === 'completed' ? 'check' : 'dot'} /></span>
                <span className="pivi-todo-text">{item.status === 'in_progress' ? (item.activeForm ?? item.content) : item.content}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function NavigationSurface({ visible, autoScrollEnabled, actions }: {
  visible: boolean;
  autoScrollEnabled: boolean;
  actions: ChatSurfaceActions;
}) {
  const t = useT();
  return (
    <div className={`pivi-nav-sidebar${visible ? ' visible' : ''}`}>
      <button aria-label={t('chat.nav.scrollToTop')} className="pivi-nav-btn pivi-nav-btn-top" onClick={actions.scrollToTop} type="button"><ObsidianIcon name="chevrons-up" /></button>
      <button aria-label={t('chat.nav.previousMessage')} className="pivi-nav-btn pivi-nav-btn-prev" onClick={actions.scrollToPreviousUserMessage} type="button"><ObsidianIcon name="chevron-up" /></button>
      <button aria-label={t('chat.nav.nextMessage')} className="pivi-nav-btn pivi-nav-btn-next" onClick={actions.scrollToNextUserMessage} type="button"><ObsidianIcon name="chevron-down" /></button>
      <button aria-label={t('chat.nav.scrollToBottom')} className="pivi-nav-btn pivi-nav-btn-bottom" onClick={actions.scrollToBottom} type="button"><ObsidianIcon name="chevrons-down" /></button>
      {!autoScrollEnabled ? <button aria-label={t('chat.nav.resumeAutoScroll')} className="pivi-nav-btn pivi-nav-btn-resume" onClick={actions.resumeAutoScroll} type="button"><ObsidianIcon name="radio" /></button> : null}
    </div>
  );
}

function ExternalContextControl({ snapshot, actions }: { snapshot: ChatUiSnapshot; actions: ComposerChromeActions }) {
  const t = useT();
  const containerRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const updateDropdownMaxWidth = useCallback((): void => {
    const container = containerRef.current;
    const dropdown = dropdownRef.current;
    if (!container || !dropdown) return;
    const ownerWindow = container.ownerDocument.defaultView ?? window;
    const left = container.getBoundingClientRect().left;
    const availableWidth = Math.max(0, ownerWindow.innerWidth - left - 20);
    dropdown.style.setProperty('--pivi-external-context-max-width', `${availableWidth}px`);
  }, []);
  const handleReveal = useCallback((): void => {
    updateDropdownMaxWidth();
  }, [updateDropdownMaxWidth]);
  useEffect(() => {
    updateDropdownMaxWidth();
  }, [updateDropdownMaxWidth]);
  const external = snapshot.externalContext;
  const count = external.availableSelectedCount === external.selectedCount
    ? String(external.selectedCount)
    : `${external.availableSelectedCount}/${external.selectedCount}`;
  const title = external.selectedCount > 0
    ? t('chat.toolbar.externalActiveTitle', { count: String(external.selectedCount) })
    : t('chat.toolbar.externalIdleTitle');
  return (
    <div
      className="pivi-external-context-selector"
      onFocusCapture={handleReveal}
      onMouseEnter={handleReveal}
      ref={containerRef}
    >
      <button
        aria-label={title}
        className={`pivi-external-context-btn${external.selectedCount > 0 ? ' active' : ''}`}
        title={title}
        type="button"
      >
        <span className="pivi-external-context-icon">
          <ObsidianIcon name="database-search" />
        </span>
        <span className={`pivi-external-context-count${external.availableSelectedCount !== external.selectedCount ? ' has-unavailable' : ''}`}>{count}</span>
      </button>
      <div className="pivi-external-context-dropdown" ref={dropdownRef}>
        <div className="pivi-external-context-header">{t('chat.toolbar.externalContexts')}</div>
        <div className="pivi-external-context-list">{external.items.length === 0 ? <div className="pivi-external-context-empty">{t('chat.toolbar.externalEmpty')}</div> : external.items.map(item => (
          <div aria-checked={item.checked} aria-label={t('chat.toolbar.externalPathAria', { path: item.displayPath })} className={`pivi-external-context-item${item.checked ? ' enabled' : ''}${item.pinned ? '' : ' has-remove'}${item.available ? '' : ' unavailable'}`} key={item.path} onClick={() => actions.toggleExternalPath(item.path)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); actions.toggleExternalPath(item.path); } }} role="checkbox" tabIndex={0}>
            <input checked={item.checked} className="pivi-external-context-checkbox" readOnly tabIndex={-1} type="checkbox" />
            <span className="pivi-external-context-text" title={item.path}>{item.displayPath}</span>
            {!item.available ? <span aria-label={t('chat.toolbar.externalUnavailable', { reason: item.unavailableReason ?? '' })} className="pivi-external-context-warning"><ObsidianIcon name="triangle-alert" /></span> : null}
            <button aria-label={item.pinned ? t('chat.toolbar.externalUnpin', { path: item.displayPath }) : t('chat.toolbar.externalPin', { path: item.displayPath })} className="pivi-external-context-action pivi-external-context-pin" onClick={event => { event.stopPropagation(); actions.toggleExternalPinned(item.path); }} type="button"><ObsidianIcon name={item.pinned ? 'pin-off' : 'pin'} /></button>
            {!item.pinned ? <button aria-label={t('chat.toolbar.externalRemove')} className="pivi-external-context-action pivi-external-context-remove" onClick={event => { event.stopPropagation(); actions.removeExternalPath(item.path); }} type="button"><ObsidianIcon name="x" /></button> : null}
          </div>
        ))}</div>
        <button className="pivi-external-context-add" onClick={actions.addExternalContext} type="button"><span className="pivi-external-context-add-icon"><ObsidianIcon name="folder-plus" /></span>{t('chat.toolbar.externalAdd')}</button>
      </div>
    </div>
  );
}

function ModelSelector({
  options,
  value,
  onChange,
}: {
  options: readonly DeepReadonly<ComposerOptionSnapshot>[];
  value: string;
  onChange: (value: string) => void;
}) {
  const t = useT();
  const selected = options.find(option => option.value === value) ?? options[0];
  const reversed = [...options].reverse();
  return (
    <div className="pivi-model-selector">
      <button aria-label={t('chat.composer.modelAria')} className="pivi-model-btn" type="button">
        {selected ? <ModelOptionIcon option={selected} /> : null}
        <span className="pivi-model-label">{selected?.label ?? 'Unknown'}</span>
      </button>
      <div className="pivi-model-dropdown">
        {reversed.map((option, index) => {
          const showGroup = Boolean(option.group && option.group !== reversed[index - 1]?.group);
          return (
            <Fragment key={option.value}>
              {showGroup ? <div className="pivi-model-group">{option.group}</div> : null}
              <button
                aria-pressed={option.value === value}
                className={`pivi-model-option${option.value === value ? ' selected' : ''}`}
                onClick={() => onChange(option.value)}
                title={option.description}
                type="button"
              >
                <ModelOptionIcon option={option} />
                <span className="pivi-model-option-label">{option.label}</span>
              </button>
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}

function ThinkingSelector({
  adaptive,
  defaultValue,
  options,
  value,
  onChange,
}: {
  adaptive: boolean;
  defaultValue: string;
  options: readonly DeepReadonly<ComposerOptionSnapshot>[];
  value: string;
  onChange: (value: string) => void;
}) {
  const t = useT();
  if (options.length === 0 || (options.length === 1 && options[0]?.value === defaultValue)) return null;
  const selected = options.find(option => option.value === value) ?? options[0];
  const fallbackLabel = adaptive ? 'High' : 'Off';
  return (
    <div className="pivi-thinking-selector">
      <div className={adaptive ? 'pivi-thinking-effort' : 'pivi-thinking-budget'}>
        <div className="pivi-thinking-gears">
          <button aria-label={t('chat.composer.reasoningAria')} className="pivi-thinking-current" type="button">
            <span className="pivi-thinking-label">{selected?.label ?? fallbackLabel}</span>
          </button>
          <div className="pivi-thinking-options">
            {[...options].reverse().map(option => {
              const tokenTitle = option.tokens === undefined
                ? option.description
                : option.tokens > 0
                  ? `${option.tokens.toLocaleString()} tokens`
                  : 'Disabled';
              return <button aria-pressed={option.value === value} className={`pivi-thinking-gear${option.value === value ? ' selected' : ''}`} key={option.value} onClick={() => onChange(option.value)} title={tokenTitle} type="button">{option.label}</button>;
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

function ModeSelector({
  activeValue,
  label,
  options,
  value,
  onChange,
}: {
  activeValue: string | null;
  label: string | null;
  options: readonly DeepReadonly<ComposerOptionSnapshot>[];
  value: string | null;
  onChange: (value: string) => void;
}) {
  if (options.length !== 2) return null;
  const active = options.find(option => option.value === activeValue) ?? options[1];
  const inactive = active?.value === options[0]?.value ? options[1] : options[0];
  const selected = options.find(option => option.value === value) ?? options[0];
  if (!active || !inactive || !selected) return null;
  const isActive = selected.value === active.value;
  const title = [`${inactive.label} <-> ${active.label}`, selected.description].filter(Boolean).join('\n');
  return (
    <button className="pivi-mode-selector" onClick={() => onChange(isActive ? inactive.value : active.value)} title={title} type="button">
      <span className={`pivi-mode-label${isActive ? ' active' : ''}`}>{selected.label || label}</span>
      <span aria-hidden="true" className={`pivi-toggle-switch${isActive ? ' active' : ''}`} />
    </button>
  );
}

function ComposerChrome({
  snapshot,
  actions,
}: {
  snapshot: ChatUiSnapshot;
  actions: ComposerChromeActions | null;
}) {
  const t = useT();
  if (!actions) return null;
  const { composer } = snapshot;
  return (
    <div className="pivi-input-toolbar">
      <ModelSelector onChange={actions.setModel} options={composer.modelOptions} value={composer.model} />
      <ThinkingSelector
        adaptive={composer.adaptiveReasoning}
        defaultValue={composer.defaultReasoningValue}
        onChange={composer.adaptiveReasoning ? actions.setThinkingLevel : actions.setThinkingBudget}
        options={composer.thinkingOptions}
        value={composer.adaptiveReasoning ? composer.thinkingLevel : composer.thinkingBudget}
      />
      <ExternalContextControl actions={actions} snapshot={snapshot} />
      <ModeSelector
        activeValue={composer.modeActiveValue}
        label={composer.modeLabel}
        onChange={actions.setMode}
        options={composer.modeOptions}
        value={composer.mode}
      />
      <div className="pivi-input-action-group">
        <UsageMeter usage={snapshot.usage} />
        <div className="pivi-send-button-wrap">
          <button
            aria-label={snapshot.isStreaming
              ? t('chat.composer.stopAria')
              : composer.canSend
                ? t('chat.composer.sendAria')
                : t('chat.composer.sendEmptyAria')}
            className={`pivi-send-button pivi-send-${snapshot.isStreaming ? 'streaming' : composer.canSend ? 'ready' : 'disabled'}`}
            disabled={!snapshot.isStreaming && !composer.canSend}
            onClick={snapshot.isStreaming ? actions.stop : actions.send}
            title={snapshot.isStreaming
              ? t('chat.composer.stopTitle')
              : composer.canSend
                ? t('chat.composer.sendTitle')
                : t('chat.composer.sendEmptyTitle')}
            type="button"
          >
            <ObsidianIcon name={snapshot.isStreaming ? 'square' : 'arrow-up'} />
          </button>
        </div>
      </div>
    </div>
  );
}

function StreamingThinkingIndicator({
  indicator,
}: {
  indicator: ChatUiSnapshot['thinkingIndicator'];
}) {
  if (!indicator) return null;
  return (
    <div className={indicator.className}>
      <span>{indicator.text}</span>
      <span className="pivi-thinking-hint">{indicator.elapsedLabel}</span>
    </div>
  );
}

function ConnectedActiveTabSurfaces({
  activeChat,
  shell,
}: {
  activeChat: ActiveChatUiBridge;
  shell: ChatShellOptions;
}) {
  const snapshot = useSyncExternalStore(
    activeChat.subscribe,
    activeChat.getSnapshot,
    activeChat.getSnapshot,
  );
  const targets = useSyncExternalStore(
    activeChat.subscribe,
    activeChat.getPortalTargets,
    activeChat.getPortalTargets,
  );
  const composerActions = useSyncExternalStore(
    activeChat.subscribe,
    activeChat.getComposerActions,
    activeChat.getComposerActions,
  );
  const messagePresentation = useSyncExternalStore(
    activeChat.subscribe,
    activeChat.getMessagePresentation,
    activeChat.getMessagePresentation,
  );
  if (!targets) return null;
  const actions = shell.surfaceActions ?? EMPTY_SURFACE_ACTIONS;
  return (
    <>
      {targets.welcome ? createPortal(<WelcomeSurface greeting={snapshot.messages.length === 0 ? snapshot.welcomeGreeting : null} quoteAdapter={shell.welcomeQuoteAdapter} />, targets.welcome) : null}
      {targets.queue ? createPortal(<QueueIndicator actions={actions} queuedTurn={snapshot.queuedTurn} />, targets.queue) : null}
      {targets.todo ? createPortal(<TodoSurface model={snapshot.currentTodoVisualizationModel} />, targets.todo) : null}
      {targets.navigation ? createPortal(<NavigationSurface actions={actions} autoScrollEnabled={snapshot.autoScrollEnabled} visible={snapshot.navigationVisible} />, targets.navigation) : null}
      {targets.composer ? createPortal(<ComposerChrome actions={composerActions} key={targets.composer.dataset.tabId} snapshot={snapshot} />, targets.composer) : null}
      {targets.messages ? createPortal(
        <>
          <MessageList
            actions={messagePresentation?.actions ?? EMPTY_MESSAGE_ACTIONS}
            contentAdapters={messagePresentation?.contentAdapters}
            messages={snapshot.messages as unknown as readonly ChatMessage[]}
          />
          <StreamingThinkingIndicator indicator={snapshot.thinkingIndicator} />
        </>,
        targets.messages,
      ) : null}
    </>
  );
}

function ActiveTabSurfaces({ shell }: { shell: ChatShellOptions }) {
  return shell.activeChat
    ? <ConnectedActiveTabSurfaces activeChat={shell.activeChat} shell={shell} />
    : null;
}

export function ChatShell({
  ownerWindow,
  setImperativeContainer,
  shell,
}: {
  ownerWindow: Window;
  setImperativeContainer: (element: HTMLDivElement | null) => void;
  shell: ChatShellOptions;
}) {
  const snapshot = useSyncExternalStore(
    shell.store.subscribe,
    shell.store.getSnapshot,
    shell.store.getSnapshot,
  );
  const inputPortalContainer = shell.inputPortalContainer;
  const tabBar = <ChatTabBar ownerWindow={ownerWindow} shell={shell} />;

  return (
      <div
        className={`pivi-react-chat-root pivi-container${snapshot.position === 'header' ? ' pivi-container--header-mode' : ''}`}
        data-pivi-react-surface="chat"
      >
        <header className="pivi-header">
          <div className="pivi-title-slot">
            <span className="pivi-logo"><ChatLogo icon={snapshot.chatIcon} /></span>
            <h4 className="pivi-title-text">Pivi</h4>
          </div>
          {snapshot.position === 'header'
            ? <div className="pivi-tab-bar-container">{tabBar}</div>
            : null}
        </header>
        <div className="pivi-tab-content-container" ref={setImperativeContainer} />
        <ActiveTabSurfaces shell={shell} />
        {snapshot.position === 'input' && inputPortalContainer
          ? createPortal(
              <div className="pivi-input-nav-content">
                <div className="pivi-tab-bar-container">{tabBar}</div>
              </div>,
              inputPortalContainer,
            )
          : null}
      </div>
  );
}

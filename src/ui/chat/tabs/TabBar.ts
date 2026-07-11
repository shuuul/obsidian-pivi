import { setIcon, setTooltip } from 'obsidian';

import { t } from '@/i18n';

import type { TabBarItem, TabId } from './types';

const TAB_TOOLTIP_DELAY_MS = 3000;
const TAB_TITLE_SCROLL_MS = 180;
const TAB_MENU_CLOSE_MS = 280;
const ARCHIVED_REVEAL_THRESHOLD = 80;

function setTabTooltip(el: HTMLElement, tooltip: string): void {
  setTooltip(el, tooltip, { delay: TAB_TOOLTIP_DELAY_MS });
}

/** Callbacks for TabBar interactions. */
export interface TabBarCallbacks {
  /** Called when a tab item is clicked. */
  onTabClick: (tabId: TabId) => void;

  /** Called when the archive button is clicked on a tab. */
  onTabArchive: (tabId: TabId) => void;

  /** Called when the tab title is edited inline. */
  onTabRenameTitle: (tabId: TabId, title: string) => void | Promise<void>;

  /** Called when the close button is clicked on a tab. */
  onTabClose: (tabId: TabId) => void;

  /** Called when the new chat button is clicked. */
  onStartNewChat: () => void;
}

/**
 * TabBar renders compact tab switching for the chat overlay.
 */
export class TabBar {
  private containerEl: HTMLElement;
  private callbacks: TabBarCallbacks;
  private items: TabBarItem[] = [];
  private isOpen = false;
  private exitingTabIds = new Set<TabId>();
  private titleTimeoutId: number | null = null;
  private menuCloseTimeoutId: number | null = null;
  private exitTimeouts = new Map<TabId, number>();
  private lastRenderedActiveId: TabId | null = null;
  private lastRenderedActiveIndex: number | null = null;
  private editingTabId: TabId | null = null;
  private archivedRevealProgress = 0;
  private isArchivedRevealed = false;
  private changedTabIds = new Set<TabId>();

  constructor(containerEl: HTMLElement, callbacks: TabBarCallbacks) {
    this.containerEl = containerEl;
    this.callbacks = callbacks;
    this.build();
  }

  /** Builds the tab bar UI. */
  private build(): void {
    this.containerEl.addClass('pivi-tab-switcher');
  }

  /**
   * Updates the tab bar with new tab data.
   * @param items Tab items to render.
   */
  update(items: TabBarItem[]): void {
    const previousItems = new Map(this.items.map(item => [item.id, item]));
    this.changedTabIds = new Set(
      items
        .filter(item => !this.isSameItem(previousItems.get(item.id), item))
        .map(item => item.id),
    );
    this.items = items;
    this.render();
    this.changedTabIds.clear();
  }

  closeMenu(): void {
    if (!this.isOpen && this.editingTabId === null) return;
    this.isOpen = false;
    this.editingTabId = null;
    this.render();
  }

  private render(): void {
    this.containerEl.toggleClass('is-open', this.isOpen);

    const activeItem = this.items.find(item => item.isActive) ?? this.items[0];
    if (!activeItem) {
      this.containerEl.empty();
      return;
    }

    if (this.isOpen) {
      this.cancelMenuCloseAnimation();
      this.renderMenu(activeItem.id);
    } else {
      const menuEl = this.containerEl.querySelector('.pivi-tab-switcher-menu');
      if (menuEl) {
        this.animateMenuClose(menuEl as HTMLElement);
      }
    }

    this.renderControl(activeItem, this.changedTabIds.has(activeItem.id));
  }

  private renderControl(activeItem: TabBarItem, activeItemChanged: boolean): void {
    let controlEl = this.containerEl.querySelector('.pivi-tab-switcher-control') as HTMLElement;
    let isNew = false;
    if (!controlEl) {
      controlEl = this.containerEl.createDiv({ cls: 'pivi-tab-switcher-control' });
      isNew = true;
    }

    if (isNew) {
      const newChatEl = controlEl.createDiv({ cls: 'pivi-tab-switcher-new-chat' });
      newChatEl.setAttribute('role', 'button');
      newChatEl.setAttribute('tabindex', '0');
      newChatEl.setAttribute('aria-label', t('chat.tabs.startNewChat'));
      setTabTooltip(newChatEl, t('chat.tabs.startNewChat'));
      setIcon(newChatEl, 'square-pen');

      const start = (event: MouseEvent | KeyboardEvent): void => {
        event.stopPropagation();
        this.isOpen = false;
        this.callbacks.onStartNewChat();
        this.render();
      };
      newChatEl.addEventListener('click', start);
      newChatEl.addEventListener('keydown', (event: KeyboardEvent) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          start(event);
        }
      });

      const triggerEl = controlEl.createDiv({ cls: 'pivi-tab-switcher-trigger' });
      triggerEl.setAttribute('role', 'button');
      triggerEl.setAttribute('tabindex', '0');
      triggerEl.setAttribute('aria-haspopup', 'menu');

      triggerEl.createSpan({
        cls: 'pivi-tab-switcher-dot',
      });
      triggerEl.createSpan({ cls: 'pivi-tab-switcher-title' });
      const chevronEl = triggerEl.createSpan({ cls: 'pivi-tab-switcher-chevron' });
      setIcon(chevronEl, 'chevron-up');

      const toggle = (event: MouseEvent | KeyboardEvent, options?: { focusMenu?: boolean }): void => {
        event.stopPropagation();
        if (!this.isOpen) {
          this.resetArchivedReveal();
        }
        this.isOpen = !this.isOpen;
        this.render();
        if (this.isOpen && options?.focusMenu) {
          this.focusActiveMenuItem();
        }
      };

      triggerEl.addEventListener('click', toggle);
      triggerEl.addEventListener('keydown', (event: KeyboardEvent) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          toggle(event, { focusMenu: true });
        }
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault();
          event.stopPropagation();
          if (!this.isOpen) {
            this.resetArchivedReveal();
            this.isOpen = true;
            this.render();
          }
          this.focusActiveMenuItem();
        }
        if (event.key === 'Escape' && this.isOpen) {
          event.preventDefault();
          this.isOpen = false;
          this.render();
        }
      });
    }

    const triggerEl = controlEl.querySelector('.pivi-tab-switcher-trigger') as HTMLElement;
    if (triggerEl) {
      triggerEl.setAttribute('aria-expanded', String(this.isOpen));
      if (isNew || activeItemChanged) {
        const switchTabLabel = t('chat.tabs.switchTab', { title: activeItem.title });
        triggerEl.setAttribute('aria-label', switchTabLabel);
        setTabTooltip(triggerEl, switchTabLabel);

        const dotEl = triggerEl.querySelector('.pivi-tab-switcher-dot') as HTMLElement;
        if (dotEl) {
          dotEl.className = `pivi-tab-switcher-dot ${this.getDotClass(activeItem)}`;
        }

        const titleEl = triggerEl.querySelector('.pivi-tab-switcher-title') as HTMLElement;
        if (titleEl) {
          if (titleEl.textContent && titleEl.textContent !== activeItem.title) {
            const activeWin = this.containerEl.ownerDocument.defaultView ?? window;
            if (this.titleTimeoutId) {
              activeWin.clearTimeout(this.titleTimeoutId);
              this.titleTimeoutId = null;
            }
            const directionClass = this.getTitleScrollClass(activeItem);
            titleEl.classList.remove('is-scrolling-up');
            titleEl.classList.remove('is-scrolling-down');
            titleEl.classList.add(directionClass);
            this.titleTimeoutId = activeWin.setTimeout(() => {
              titleEl.textContent = activeItem.title;
              titleEl.classList.remove(directionClass);
              this.titleTimeoutId = null;
            }, TAB_TITLE_SCROLL_MS);
          } else {
            const activeWin = this.containerEl.ownerDocument.defaultView ?? window;
            if (this.titleTimeoutId) {
              activeWin.clearTimeout(this.titleTimeoutId);
              this.titleTimeoutId = null;
            }
            titleEl.textContent = activeItem.title;
            titleEl.classList.remove('is-scrolling-up');
            titleEl.classList.remove('is-scrolling-down');
          }
        }
      }
    }

    this.lastRenderedActiveId = activeItem.id;
    this.lastRenderedActiveIndex = activeItem.index;
  }

  private focusActiveMenuItem(): void {
    const menuEl = this.containerEl.querySelector<HTMLElement>('.pivi-tab-switcher-menu');
    const itemEls = Array.from(menuEl?.querySelectorAll<HTMLElement>('.pivi-tab-switcher-item') ?? []);
    const activeItem = this.items.find(item => item.isActive);
    const activeItemEl = activeItem
      ? itemEls.find(el => el.getAttribute('data-tab-id') === activeItem.id)
      : null;
    (activeItemEl ?? itemEls[0])?.focus();
  }

  private focusAdjacentMenuItem(tabId: TabId, direction: 1 | -1): void {
    const menuEl = this.containerEl.querySelector<HTMLElement>('.pivi-tab-switcher-menu');
    const itemEls = Array.from(menuEl?.querySelectorAll<HTMLElement>('.pivi-tab-switcher-item') ?? []);
    if (itemEls.length === 0) return;

    const currentIndex = itemEls.findIndex(el => el.getAttribute('data-tab-id') === tabId);
    const nextIndex = currentIndex >= 0
      ? (currentIndex + direction + itemEls.length) % itemEls.length
      : direction > 0 ? 0 : itemEls.length - 1;
    itemEls[nextIndex]?.focus();
  }

  private getTitleScrollClass(activeItem: TabBarItem): string {
    if (!this.lastRenderedActiveId || this.lastRenderedActiveId === activeItem.id || this.lastRenderedActiveIndex === null) {
      return 'is-scrolling-up';
    }
    return activeItem.index < this.lastRenderedActiveIndex ? 'is-scrolling-down' : 'is-scrolling-up';
  }

  private animateMenuClose(menuEl: HTMLElement): void {
    if (menuEl.classList.contains('is-closing')) {
      return;
    }

    menuEl.classList.add('is-closing');
    const activeWin = this.containerEl.ownerDocument.defaultView ?? window;
    this.menuCloseTimeoutId = activeWin.setTimeout(() => {
      menuEl.remove();
      this.menuCloseTimeoutId = null;
    }, TAB_MENU_CLOSE_MS);
  }

  private cancelMenuCloseAnimation(): void {
    const activeWin = this.containerEl.ownerDocument.defaultView ?? window;
    if (this.menuCloseTimeoutId) {
      activeWin.clearTimeout(this.menuCloseTimeoutId);
      this.menuCloseTimeoutId = null;
    }
    const menuEl = this.containerEl.querySelector('.pivi-tab-switcher-menu');
    menuEl?.classList.remove('is-closing');
  }

  private renderMenu(activeId: TabId): void {
    let menuEl = this.containerEl.querySelector('.pivi-tab-switcher-menu') as HTMLElement;
    let isNew = false;
    if (!menuEl) {
      menuEl = this.containerEl.createDiv({ cls: 'pivi-tab-switcher-menu' });
      menuEl.setAttribute('role', 'menu');
      menuEl.addEventListener('click', event => event.stopPropagation());
      menuEl.addEventListener('wheel', (event) => this.handleMenuWheel(event), { passive: false });
      isNew = true;
    }

    menuEl.classList.toggle('is-archived-revealed', this.isArchivedRevealed);

    // Open tabs are listed first and archived tabs intentionally remain below
    // the initial viewport. Preserve the user's top-based scroll position while
    // reconciliation re-appends rows instead of tracking distance from the
    // bottom, which makes removing the final visible row jump the whole list.
    const previousScrollTop = isNew ? 0 : menuEl.scrollTop;

    const openItems = this.items.filter(item => !item.isArchived);
    const archivedItems = this.items.filter(item => item.isArchived);
    menuEl.style.setProperty('--pivi-tab-menu-open-height', `${Math.max(1, openItems.length) * 28}px`);

    // 1. Collect all existing item elements
    const existingItems = new Map<TabId, HTMLElement>();
    menuEl.querySelectorAll('.pivi-tab-switcher-item').forEach((el) => {
      const id = el.getAttribute('data-tab-id');
      if (id) {
        existingItems.set(id, el as HTMLElement);
      }
    });

    const desiredItems = [...openItems, ...archivedItems];
    const existingOrder = Array.from(existingItems.keys());
    const structureChanged = existingOrder.length !== desiredItems.length
      || desiredItems.some((item, index) => {
        const existingEl = existingItems.get(item.id);
        return existingOrder[index] !== item.id
          || existingEl?.classList.contains('is-archived') !== item.isArchived;
      });

    // 2. Remove elements that are no longer present
    const currentIds = new Set(this.items.map(item => item.id));
    existingItems.forEach((el, id) => {
      if (!currentIds.has(id)) {
        el.remove();
        existingItems.delete(id);
      }
    });

    // Status-only background updates keep every row in place. Rebuild ordering
    // only when tabs were added, removed, reordered, archived, or restored.
    if (structureChanged) {
      menuEl.querySelectorAll('.pivi-tab-switcher-section-label').forEach(el => el.remove());
    }

    // 4. Render or update open items
    for (const item of openItems) {
      if (structureChanged || this.changedTabIds.has(item.id) || this.editingTabId === item.id) {
        this.renderOrUpdateMenuItem(menuEl, item, activeId, existingItems.get(item.id), structureChanged);
      }
    }

    // 5. Render archived items
    if (archivedItems.length > 0) {
      if (structureChanged || !menuEl.querySelector('.pivi-tab-switcher-section-label')) {
        menuEl.createDiv({ cls: 'pivi-tab-switcher-section-label', text: t('chat.tabs.archived') });
      }
      for (const item of archivedItems) {
        if (structureChanged || this.changedTabIds.has(item.id) || this.editingTabId === item.id) {
          this.renderOrUpdateMenuItem(menuEl, item, activeId, existingItems.get(item.id), structureChanged);
        }
      }
    }

    menuEl.scrollTop = previousScrollTop;
  }

  private handleMenuWheel(event: WheelEvent): void {
    if (this.isArchivedRevealed || event.deltaY <= 0 || !this.items.some(item => item.isArchived)) return;

    event.preventDefault();
    this.archivedRevealProgress += event.deltaY;
    if (this.archivedRevealProgress < ARCHIVED_REVEAL_THRESHOLD) return;

    this.isArchivedRevealed = true;
    this.archivedRevealProgress = 0;
    this.render();
  }

  private resetArchivedReveal(): void {
    this.archivedRevealProgress = 0;
    this.isArchivedRevealed = false;
  }

  private isSameItem(previous: TabBarItem | undefined, current: TabBarItem): boolean {
    return previous !== undefined
      && previous.index === current.index
      && previous.title === current.title
      && previous.isActive === current.isActive
      && previous.canClose === current.canClose
      && previous.isArchived === current.isArchived
      && previous.needsAttention === current.needsAttention
      && previous.isStreaming === current.isStreaming;
  }

  private renderOrUpdateMenuItem(
    menuEl: HTMLElement,
    item: TabBarItem,
    activeId: TabId,
    existingEl?: HTMLElement,
    moveExisting = true,
  ): void {
    let itemEl = existingEl;
    let isNew = false;
    if (!itemEl) {
      itemEl = menuEl.createDiv({ cls: 'pivi-tab-switcher-item' });
      itemEl.setAttribute('data-tab-id', item.id);
      isNew = true;
    } else if (moveExisting) {
      menuEl.appendChild(itemEl);
    }

    const isExiting = this.exitingTabIds.has(item.id);
    itemEl.className = `pivi-tab-switcher-item ${item.id === activeId ? 'is-active' : ''} ${item.needsAttention ? 'needs-attention' : ''} ${item.isArchived ? 'is-archived' : ''} ${isExiting ? 'is-exiting' : ''} ${this.editingTabId === item.id ? 'is-editing' : ''}`;
    itemEl.setAttribute('role', 'menuitem');
    itemEl.setAttribute('tabindex', '0');
    itemEl.setAttribute('aria-label', item.title);
    setTabTooltip(itemEl, item.title);

    if (isNew) {
      itemEl.createSpan({
        cls: 'pivi-tab-switcher-dot',
      });
      itemEl.createSpan({ cls: 'pivi-tab-switcher-item-title' });

      const beginTitleEdit = (): void => {
        const currentItem = this.items.find(it => it.id === item.id);
        if (!currentItem || itemEl.classList.contains('is-exiting')) return;

        this.editingTabId = currentItem.id;
        this.renderTabItem(currentItem.id);
      };

      const editTitleEl = itemEl.createSpan({ cls: 'pivi-tab-switcher-action pivi-tab-switcher-edit-title' });
      editTitleEl.setAttribute('role', 'button');
      editTitleEl.setAttribute('tabindex', '0');
      editTitleEl.addEventListener('click', (event) => {
        event.stopPropagation();
        beginTitleEdit();
      });
      editTitleEl.addEventListener('keydown', (event) => {
        event.stopPropagation();
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          beginTitleEdit();
        }
      });

      const archiveEl = itemEl.createSpan({ cls: 'pivi-tab-switcher-action pivi-tab-switcher-archive' });
      archiveEl.setAttribute('role', 'button');
      archiveEl.addEventListener('click', (event) => {
        event.stopPropagation();
        const currentItem = this.items.find(it => it.id === item.id);
        if (!currentItem) return;

        if (currentItem.isArchived) {
          this.isOpen = false;
          this.callbacks.onTabClick(currentItem.id);
          this.render();
        } else {
          if (itemEl.classList.contains('is-exiting')) return;
          this.exitingTabIds.add(currentItem.id);
          itemEl.classList.add('is-exiting');

          // If archiving the active tab, switch view immediately
          if (currentItem.isActive) {
            const fallbackItem = this.getFallbackItemForActiveRemoval(currentItem.id);
            if (fallbackItem) {
              this.callbacks.onTabClick(fallbackItem.id);
            }
          }

          const activeWin = this.containerEl.ownerDocument.defaultView ?? window;
          const tid = activeWin.setTimeout(() => {
            this.exitTimeouts.delete(currentItem.id);
            this.exitingTabIds.delete(currentItem.id);
            this.callbacks.onTabArchive(currentItem.id);
          }, 200);
          this.exitTimeouts.set(currentItem.id, tid);
        }
      });

      const select = (event: MouseEvent | KeyboardEvent): void => {
        event.stopPropagation();
        const currentItem = this.items.find(it => it.id === item.id);
        if (!currentItem || this.exitingTabIds.has(currentItem.id)) return;

        this.isOpen = false;
        this.callbacks.onTabClick(currentItem.id);
        this.render();
      };
      itemEl.addEventListener('click', select);
      itemEl.addEventListener('keydown', (event: KeyboardEvent) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          select(event);
        } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault();
          event.stopPropagation();
          this.focusAdjacentMenuItem(item.id, event.key === 'ArrowDown' ? 1 : -1);
        } else if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          this.closeMenu();
        }
      });
    }

    // Update Dot
    const dotEl = itemEl.querySelector('.pivi-tab-switcher-dot') as HTMLElement;
    if (dotEl) {
      dotEl.className = `pivi-tab-switcher-dot ${this.getDotClass(item)}`;
    }

    const titleEl = itemEl.querySelector('.pivi-tab-switcher-item-title') as HTMLElement;
    if (titleEl) {
      this.renderMenuItemTitle(titleEl, item);
    }

    const editTitleEl = itemEl.querySelector('.pivi-tab-switcher-edit-title') as HTMLElement;
    if (editTitleEl) {
      editTitleEl.empty();
      setIcon(editTitleEl, 'pencil');
      const editTitleLabel = t('chat.tabs.editTitle', { title: item.title });
      editTitleEl.setAttribute('aria-label', editTitleLabel);
      setTabTooltip(editTitleEl, editTitleLabel);
    }

    // Update Archive Button
    const archiveEl = itemEl.querySelector('.pivi-tab-switcher-archive') as HTMLElement;
    if (archiveEl) {
      archiveEl.empty(); // Clear only the inner SVG icon
      setIcon(archiveEl, item.isArchived ? 'archive-restore' : 'archive');
      const archiveLabel = item.isArchived
        ? t('chat.tabs.restoreTab', { title: item.title })
        : t('chat.tabs.archiveTab', { title: item.title });
      archiveEl.setAttribute('aria-label', archiveLabel);
      setTabTooltip(archiveEl, archiveLabel);
    }

    // Update/Create/Remove Close Button
    let closeEl = itemEl.querySelector('.pivi-tab-switcher-close') as HTMLElement;
    if (item.canClose) {
      if (!closeEl) {
        closeEl = itemEl.createSpan({ cls: 'pivi-tab-switcher-action pivi-tab-switcher-close' });
        setIcon(closeEl, 'x');
        closeEl.setAttribute('role', 'button');
        closeEl.addEventListener('click', (event) => {
          event.stopPropagation();
          const currentItem = this.items.find(it => it.id === item.id);
          if (!currentItem) return;

          if (itemEl.classList.contains('is-exiting')) return;
          this.exitingTabIds.add(currentItem.id);
          itemEl.classList.add('is-exiting');

          // If closing the active tab, switch view immediately
          if (currentItem.isActive) {
            const fallbackItem = this.getFallbackItemForActiveRemoval(currentItem.id);
            if (fallbackItem) {
              this.callbacks.onTabClick(fallbackItem.id);
            }
          }

          const activeWin = this.containerEl.ownerDocument.defaultView ?? window;
          const tid = activeWin.setTimeout(() => {
            this.exitTimeouts.delete(currentItem.id);
            this.exitingTabIds.delete(currentItem.id);
            this.callbacks.onTabClose(currentItem.id);
          }, 200);
          this.exitTimeouts.set(currentItem.id, tid);
        });
      }
      const closeLabel = t('chat.tabs.closeTab', { title: item.title });
      closeEl.setAttribute('aria-label', closeLabel);
      setTabTooltip(closeEl, closeLabel);
    } else if (closeEl) {
      closeEl.remove();
    }
  }

  private renderMenuItemTitle(titleEl: HTMLElement, item: TabBarItem): void {
    if (this.editingTabId !== item.id) {
      titleEl.textContent = item.title;
      return;
    }

    titleEl.empty();
    const inputEl = titleEl.createEl('input', {
      attr: {
        'aria-label': t('chat.tabs.editTitleInputLabel'),
        type: 'text',
      },
      cls: 'pivi-tab-switcher-title-input',
    });
    inputEl.value = item.title;

    let submitted = false;
    const cancel = (): void => {
      if (submitted) return;
      this.editingTabId = null;
      this.renderTabItem(item.id);
    };
    const submit = (): void => {
      if (submitted) return;
      submitted = true;
      const title = inputEl.value.trim();
      this.editingTabId = null;
      if (title && title !== item.title) {
        void Promise.resolve(this.callbacks.onTabRenameTitle(item.id, title)).finally(() => this.renderTabItem(item.id));
        return;
      }
      this.renderTabItem(item.id);
    };

    inputEl.addEventListener('click', event => event.stopPropagation());
    inputEl.addEventListener('keydown', (event) => {
      event.stopPropagation();
      if (event.key === 'Enter') {
        event.preventDefault();
        submit();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        cancel();
      }
    });
    inputEl.addEventListener('blur', submit);
    inputEl.focus({ preventScroll: true });
    const cursorPosition = inputEl.value.length;
    inputEl.setSelectionRange(cursorPosition, cursorPosition);
    inputEl.scrollLeft = inputEl.scrollWidth;
  }

  private renderTabItem(tabId: TabId): void {
    this.changedTabIds.add(tabId);
    this.render();
    this.changedTabIds.delete(tabId);
  }

  private getDotClass(item: TabBarItem): string {
    if (item.isStreaming) {
      return 'is-live';
    }
    if (item.needsAttention) {
      return 'is-unread';
    }
    return '';
  }

  private getFallbackItemForActiveRemoval(tabId: TabId): TabBarItem | null {
    const openItems = this.items.filter(item => !item.isArchived);
    const openIndex = openItems.findIndex(item => item.id === tabId);
    if (openIndex >= 0) {
      return openItems[openIndex - 1] ?? openItems[openIndex + 1] ?? null;
    }

    const itemIndex = this.items.findIndex(item => item.id === tabId);
    return this.items[itemIndex - 1] ?? this.items[itemIndex + 1] ?? null;
  }

  /** Destroys the tab bar. */
  destroy(): void {
    const activeWin = this.containerEl.ownerDocument.defaultView ?? window;
    if (this.titleTimeoutId) {
      activeWin.clearTimeout(this.titleTimeoutId);
      this.titleTimeoutId = null;
    }
    if (this.menuCloseTimeoutId) {
      activeWin.clearTimeout(this.menuCloseTimeoutId);
      this.menuCloseTimeoutId = null;
    }
    for (const tid of this.exitTimeouts.values()) {
      activeWin.clearTimeout(tid);
    }
    this.exitTimeouts.clear();

    this.containerEl.empty();
    this.containerEl.removeClass('pivi-tab-switcher');
    this.containerEl.removeClass('is-open');
  }
}

import { setIcon, setTooltip } from 'obsidian';

import type { TabBarItem, TabId } from './types';

const TAB_TOOLTIP_DELAY_MS = 3000;

function setTabTooltip(el: HTMLElement, tooltip: string): void {
  setTooltip(el, tooltip, { delay: TAB_TOOLTIP_DELAY_MS });
}

/** Callbacks for TabBar interactions. */
export interface TabBarCallbacks {
  /** Called when a tab item is clicked. */
  onTabClick: (tabId: TabId) => void;

  /** Called when the archive button is clicked on a tab. */
  onTabArchive: (tabId: TabId) => void;

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
  private exitTimeouts = new Map<TabId, number>();

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
    this.items = items;
    this.render();
  }

  closeMenu(): void {
    if (!this.isOpen) return;
    this.isOpen = false;
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
      this.renderMenu(activeItem.id);
    } else {
      const menuEl = this.containerEl.querySelector('.pivi-tab-switcher-menu');
      if (menuEl) {
        menuEl.remove();
      }
    }

    this.renderControl(activeItem);
  }

  private renderControl(activeItem: TabBarItem): void {
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
      newChatEl.setAttribute('aria-label', 'Start new chat');
      setTabTooltip(newChatEl, 'Start new chat');
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

      const toggle = (event: MouseEvent | KeyboardEvent): void => {
        event.stopPropagation();
        this.isOpen = !this.isOpen;
        this.render();
      };

      triggerEl.addEventListener('click', toggle);
      triggerEl.addEventListener('keydown', (event: KeyboardEvent) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          toggle(event);
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
      triggerEl.setAttribute('aria-label', `Switch tab: ${activeItem.title}`);
      setTabTooltip(triggerEl, `Switch tab: ${activeItem.title}`);

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
          titleEl.classList.add('is-updating');
          this.titleTimeoutId = activeWin.setTimeout(() => {
            titleEl.textContent = activeItem.title;
            titleEl.classList.remove('is-updating');
            this.titleTimeoutId = null;
          }, 120);
        } else {
          const activeWin = this.containerEl.ownerDocument.defaultView ?? window;
          if (this.titleTimeoutId) {
            activeWin.clearTimeout(this.titleTimeoutId);
            this.titleTimeoutId = null;
          }
          titleEl.textContent = activeItem.title;
          titleEl.classList.remove('is-updating');
        }
      }
    }
  }

  private renderMenu(activeId: TabId): void {
    let menuEl = this.containerEl.querySelector('.pivi-tab-switcher-menu') as HTMLElement;
    if (!menuEl) {
      menuEl = this.containerEl.createDiv({ cls: 'pivi-tab-switcher-menu' });
      menuEl.setAttribute('role', 'menu');
      menuEl.addEventListener('click', event => event.stopPropagation());
    }

    const openItems = this.items.filter(item => !item.isArchived);
    const archivedItems = this.items.filter(item => item.isArchived);

    // 1. Collect all existing item elements
    const existingItems = new Map<TabId, HTMLElement>();
    menuEl.querySelectorAll('.pivi-tab-switcher-item').forEach((el) => {
      const id = el.getAttribute('data-tab-id');
      if (id) {
        existingItems.set(id, el as HTMLElement);
      }
    });

    // 2. Remove elements that are no longer present
    const currentIds = new Set(this.items.map(item => item.id));
    existingItems.forEach((el, id) => {
      if (!currentIds.has(id)) {
        el.remove();
        existingItems.delete(id);
      }
    });

    // 3. Clear section labels so they can be re-created in order
    menuEl.querySelectorAll('.pivi-tab-switcher-section-label').forEach(el => el.remove());

    // 4. Render or update open items
    for (const item of openItems) {
      this.renderOrUpdateMenuItem(menuEl, item, activeId, existingItems.get(item.id));
    }

    // 5. Render archived items
    if (archivedItems.length > 0) {
      menuEl.createDiv({ cls: 'pivi-tab-switcher-section-label', text: 'Archived' });
      for (const item of archivedItems) {
        this.renderOrUpdateMenuItem(menuEl, item, activeId, existingItems.get(item.id));
      }
    }
  }

  private renderOrUpdateMenuItem(menuEl: HTMLElement, item: TabBarItem, activeId: TabId, existingEl?: HTMLElement): void {
    let itemEl = existingEl;
    let isNew = false;
    if (!itemEl) {
      itemEl = menuEl.createDiv({ cls: 'pivi-tab-switcher-item' });
      itemEl.setAttribute('data-tab-id', item.id);
      isNew = true;
    } else {
      menuEl.appendChild(itemEl);
    }

    const isExiting = this.exitingTabIds.has(item.id);
    itemEl.className = `pivi-tab-switcher-item ${item.id === activeId ? 'is-active' : ''} ${item.needsAttention ? 'needs-attention' : ''} ${item.isArchived ? 'is-archived' : ''} ${isExiting ? 'is-exiting' : ''}`;
    itemEl.setAttribute('role', 'menuitem');
    itemEl.setAttribute('tabindex', '0');
    itemEl.setAttribute('aria-label', item.title);
    setTabTooltip(itemEl, item.title);

    if (isNew) {
      itemEl.createSpan({
        cls: 'pivi-tab-switcher-dot',
      });
      itemEl.createSpan({ cls: 'pivi-tab-switcher-item-title' });

      const archiveEl = itemEl.createSpan({ cls: 'pivi-tab-switcher-archive' });
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
            const fallbackItem = this.items.find(it => it.id !== currentItem.id && !it.isArchived)
                              ?? this.items.find(it => it.id !== currentItem.id);
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
        }
      });
    }

    // Update Dot
    const dotEl = itemEl.querySelector('.pivi-tab-switcher-dot') as HTMLElement;
    if (dotEl) {
      dotEl.className = `pivi-tab-switcher-dot ${this.getDotClass(item)}`;
    }

    // Update Title
    const titleEl = itemEl.querySelector('.pivi-tab-switcher-item-title') as HTMLElement;
    if (titleEl) {
      titleEl.textContent = item.title;
    }

    // Update Archive Button
    const archiveEl = itemEl.querySelector('.pivi-tab-switcher-archive') as HTMLElement;
    if (archiveEl) {
      archiveEl.empty(); // Clear only the inner SVG icon
      setIcon(archiveEl, item.isArchived ? 'archive-restore' : 'archive');
      archiveEl.setAttribute('aria-label', item.isArchived ? `Restore ${item.title}` : `Archive ${item.title}`);
      setTabTooltip(archiveEl, item.isArchived ? `Restore ${item.title}` : `Archive ${item.title}`);
    }

    // Update/Create/Remove Close Button
    let closeEl = itemEl.querySelector('.pivi-tab-switcher-close') as HTMLElement;
    if (item.canClose) {
      if (!closeEl) {
        closeEl = itemEl.createSpan({ cls: 'pivi-tab-switcher-close' });
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
            const fallbackItem = this.items.find(it => it.id !== currentItem.id && !it.isArchived)
                              ?? this.items.find(it => it.id !== currentItem.id);
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
      closeEl.setAttribute('aria-label', `Close ${item.title}`);
      setTabTooltip(closeEl, `Close ${item.title}`);
    } else if (closeEl) {
      closeEl.remove();
    }
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

  /** Destroys the tab bar. */
  destroy(): void {
    const activeWin = this.containerEl.ownerDocument.defaultView ?? window;
    if (this.titleTimeoutId) {
      activeWin.clearTimeout(this.titleTimeoutId);
      this.titleTimeoutId = null;
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

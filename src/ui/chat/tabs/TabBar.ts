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
    this.containerEl.empty();
    this.containerEl.toggleClass('is-open', this.isOpen);

    const activeItem = this.items.find(item => item.isActive) ?? this.items[0];
    if (!activeItem) {
      return;
    }

    if (this.isOpen) {
      this.renderMenu(activeItem.id);
    }

    this.renderControl(activeItem);
  }

  private renderControl(activeItem: TabBarItem): void {
    const controlEl = this.containerEl.createDiv({ cls: 'pivi-tab-switcher-control' });

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
    triggerEl.setAttribute('aria-expanded', String(this.isOpen));
    triggerEl.setAttribute('aria-label', `Switch tab: ${activeItem.title}`);
    setTabTooltip(triggerEl, `Switch tab: ${activeItem.title}`);

    triggerEl.createSpan({
      cls: `pivi-tab-switcher-dot ${this.getDotClass(activeItem)}`,
    });
    triggerEl.createSpan({ cls: 'pivi-tab-switcher-title', text: activeItem.title });
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

  private renderMenu(activeId: TabId): void {
    const menuEl = this.containerEl.createDiv({ cls: 'pivi-tab-switcher-menu' });
    menuEl.setAttribute('role', 'menu');
    menuEl.addEventListener('click', event => event.stopPropagation());

    const openItems = this.items.filter(item => !item.isArchived);
    const archivedItems = this.items.filter(item => item.isArchived);

    for (const item of openItems) {
      this.renderMenuItem(menuEl, item, activeId);
    }

    if (archivedItems.length > 0) {
      menuEl.createDiv({ cls: 'pivi-tab-switcher-section-label', text: 'Archived' });
      for (const item of archivedItems) {
        this.renderMenuItem(menuEl, item, activeId);
      }
    }
  }

  private renderMenuItem(menuEl: HTMLElement, item: TabBarItem, activeId: TabId): void {
    const itemEl = menuEl.createDiv({
      cls: `pivi-tab-switcher-item ${item.id === activeId ? 'is-active' : ''} ${item.needsAttention ? 'needs-attention' : ''} ${item.isArchived ? 'is-archived' : ''}`,
    });
    itemEl.setAttribute('role', 'menuitem');
    itemEl.setAttribute('tabindex', '0');
    itemEl.setAttribute('aria-label', item.title);
    setTabTooltip(itemEl, item.title);

    itemEl.createSpan({
      cls: `pivi-tab-switcher-dot ${this.getDotClass(item)}`,
    });
    itemEl.createSpan({ cls: 'pivi-tab-switcher-item-title', text: item.title });

    if (item.id === activeId) {
      const checkEl = itemEl.createSpan({ cls: 'pivi-tab-switcher-check' });
      setIcon(checkEl, 'check');
    }

    const archiveEl = itemEl.createSpan({ cls: 'pivi-tab-switcher-archive' });
    setIcon(archiveEl, item.isArchived ? 'archive-restore' : 'archive');
    archiveEl.setAttribute('aria-label', item.isArchived ? `Restore ${item.title}` : `Archive ${item.title}`);
    setTabTooltip(archiveEl, item.isArchived ? `Restore ${item.title}` : `Archive ${item.title}`);
    archiveEl.setAttribute('role', 'button');
    archiveEl.addEventListener('click', (event) => {
      event.stopPropagation();
      if (item.isArchived) {
        this.isOpen = false;
        this.callbacks.onTabClick(item.id);
      } else {
        this.callbacks.onTabArchive(item.id);
      }
      this.render();
    });

    if (item.canClose) {
      const closeEl = itemEl.createSpan({ cls: 'pivi-tab-switcher-close' });
      setIcon(closeEl, 'x');
      closeEl.setAttribute('aria-label', `Close ${item.title}`);
      setTabTooltip(closeEl, `Close ${item.title}`);
      closeEl.setAttribute('role', 'button');
      closeEl.addEventListener('click', (event) => {
        event.stopPropagation();
        this.isOpen = false;
        this.callbacks.onTabClose(item.id);
        this.render();
      });
    }

    const select = (event: MouseEvent | KeyboardEvent): void => {
      event.stopPropagation();
      this.isOpen = false;
      this.callbacks.onTabClick(item.id);
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
    this.containerEl.empty();
    this.containerEl.removeClass('pivi-tab-switcher');
    this.containerEl.removeClass('is-open');
  }
}

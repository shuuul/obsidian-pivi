import { TabBar } from '@/ui/chat/tabs/TabBar';
import type { TabBarItem, TabId } from '@/ui/chat/tabs/types';

class MockElement {
  listeners: Record<string, Function[]> = {};
  classes = new Set<string>();
  attributes = new Map<string, string>();
  children: MockElement[] = [];
  textContent?: string;
  parent: MockElement | null = null;
  ownerDocument = {
    defaultView: globalThis,
  };

  get className(): string {
    return Array.from(this.classes).join(' ');
  }

  set className(val: string) {
    this.classes.clear();
    val.split(' ').filter(Boolean).forEach(c => this.classes.add(c));
  }

  get classList() {
    return {
      add: (cls: string) => this.addClass(cls),
      remove: (cls: string) => this.removeClass(cls),
      contains: (cls: string) => this.classes.has(cls),
    };
  }

  addClass(cls: string) {
    this.classes.add(cls);
  }
  removeClass(cls: string) {
    this.classes.delete(cls);
  }
  toggleClass(cls: string, force?: boolean) {
    if (force === undefined) {
      if (this.classes.has(cls)) this.classes.delete(cls);
      else this.classes.add(cls);
    } else {
      if (force) this.classes.add(cls);
      else this.classes.delete(cls);
    }
  }
  setAttribute(name: string, value: string) {
    this.attributes.set(name, value);
  }
  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }
  addEventListener(event: string, callback: Function) {
    if (!this.listeners[event]) this.listeners[event] = [];
    this.listeners[event].push(callback);
  }
  createDiv(options?: { cls?: string; text?: string }) {
    const el = new MockElement();
    el.parent = this;
    if (options?.cls) {
      options.cls.split(' ').filter(Boolean).forEach(c => el.addClass(c));
    }
    if (options?.text) {
      el.textContent = options.text;
    }
    this.children.push(el);
    return el;
  }
  createSpan(options?: { cls?: string; text?: string }) {
    const el = new MockElement();
    el.parent = this;
    if (options?.cls) {
      options.cls.split(' ').filter(Boolean).forEach(c => el.addClass(c));
    }
    if (options?.text) {
      el.textContent = options.text;
    }
    this.children.push(el);
    return el;
  }
  appendChild(child: MockElement) {
    if (child.parent) {
      child.parent.children = child.parent.children.filter(c => c !== child);
    }
    child.parent = this;
    this.children.push(child);
  }
  querySelector(selector: string): any {
    const className = selector.replace(/^\./, '');
    const search = (el: MockElement): MockElement | null => {
      if (el.classes.has(className)) return el;
      for (const child of el.children) {
        const found = search(child);
        if (found) return found;
      }
      return null;
    };
    for (const child of this.children) {
      const found = search(child);
      if (found) return found;
    }
    return null;
  }
  querySelectorAll(selector: string): MockElement[] {
    const className = selector.replace(/^\./, '');
    const results: MockElement[] = [];
    const search = (el: MockElement) => {
      if (el.classes.has(className)) {
        results.push(el);
      }
      for (const child of el.children) {
        search(child);
      }
    };
    for (const child of this.children) {
      search(child);
    }
    return results;
  }
  empty() {
    for (const child of this.children) {
      child.parent = null;
    }
    this.children = [];
  }
  remove() {
    if (this.parent) {
      this.parent.children = this.parent.children.filter(c => c !== this);
      this.parent = null;
    }
  }
  trigger(event: string, eventObj: any = { stopPropagation: () => {}, preventDefault: () => {} }) {
    if (this.listeners[event]) {
      for (const listener of this.listeners[event]) {
        listener(eventObj);
      }
    }
  }
}

describe('TabBar UI Component', () => {
  let containerEl: MockElement;
  let callbacks: {
    onTabClick: jest.Mock;
    onTabArchive: jest.Mock;
    onTabClose: jest.Mock;
    onStartNewChat: jest.Mock;
  };
  let items: TabBarItem[];

  beforeEach(() => {
    jest.useFakeTimers();
    containerEl = new MockElement();
    callbacks = {
      onTabClick: jest.fn(),
      onTabArchive: jest.fn(),
      onTabClose: jest.fn(),
      onStartNewChat: jest.fn(),
    };
    items = [
      { id: 'tab1' as TabId, index: 1, title: 'Tab 1', isActive: true, canClose: true, isArchived: false, needsAttention: false, isStreaming: false },
      { id: 'tab2' as TabId, index: 2, title: 'Tab 2', isActive: false, canClose: true, isArchived: false, needsAttention: false, isStreaming: false },
    ];
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('correctly tracks exiting state and prevents race conditions on close', () => {
    const tabBar = new TabBar(containerEl as any, callbacks);
    tabBar.update(items);

    // Open the menu first
    const controlEl = containerEl.querySelector('.pivi-tab-switcher-control');
    const triggerEl = controlEl.querySelector('.pivi-tab-switcher-trigger');
    triggerEl.trigger('click');

    const menuEl = containerEl.querySelector('.pivi-tab-switcher-menu');
    // Find tab2 elements by checking children for Tab 2 title
    const tab2El = (menuEl.children as MockElement[]).find((child: MockElement) => 
      child.classes.has('pivi-tab-switcher-item') &&
      child.children.some((c: MockElement) => c.textContent === 'Tab 2')
    );
    expect(tab2El).toBeDefined();

    // Find the close element inside tab2El
    const closeEl = (tab2El?.children as MockElement[]).find((child: MockElement) => child.classes.has('pivi-tab-switcher-close'));
    expect(closeEl).toBeDefined();

    // Trigger first close click
    closeEl?.trigger('click');
    expect(tab2El?.classes.has('is-exiting')).toBe(true);

    // Trigger a second close click immediately (should be ignored due to exitingTabIds)
    closeEl?.trigger('click');

    // Trigger regular select click on tab2 (should be ignored due to exitingTabIds)
    tab2El?.trigger('click');

    // Run timers for the 200ms timeout
    jest.advanceTimersByTime(200);

    // Verify onTabClose was called exactly once, and onTabClick/other calls were not made
    expect(callbacks.onTabClose).toHaveBeenCalledTimes(1);
    expect(callbacks.onTabClose).toHaveBeenCalledWith('tab2');
    expect(callbacks.onTabClick).not.toHaveBeenCalled();
  });

  it('correctly tracks exiting state and prevents race conditions on archive', () => {
    const tabBar = new TabBar(containerEl as any, callbacks);
    tabBar.update(items);

    // Open the menu
    const controlEl = containerEl.querySelector('.pivi-tab-switcher-control');
    const triggerEl = controlEl.querySelector('.pivi-tab-switcher-trigger');
    triggerEl.trigger('click');

    const menuEl = containerEl.querySelector('.pivi-tab-switcher-menu');
    const tab2El = (menuEl.children as MockElement[]).find((child: MockElement) => 
      child.classes.has('pivi-tab-switcher-item') &&
      child.children.some((c: MockElement) => c.textContent === 'Tab 2')
    );
    const archiveEl = (tab2El?.children as MockElement[]).find((child: MockElement) => child.classes.has('pivi-tab-switcher-archive'));
    expect(archiveEl).toBeDefined();

    // Trigger archive click
    archiveEl?.trigger('click');
    expect(tab2El?.classes.has('is-exiting')).toBe(true);

    // Attempt second archive click
    archiveEl?.trigger('click');

    // Attempt click on the item
    tab2El?.trigger('click');

    // Advance timer
    jest.advanceTimersByTime(200);

    expect(callbacks.onTabArchive).toHaveBeenCalledTimes(1);
    expect(callbacks.onTabArchive).toHaveBeenCalledWith('tab2');
    expect(callbacks.onTabClick).not.toHaveBeenCalled();
  });
});

# Tab Switcher Background Flicker Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent the remaining dropdown menu items from flashing when a tab is archived or closed by implementing in-place DOM reconciliation for tab list items.

**Architecture:**
- Query existing `.pivi-tab-switcher-item` nodes in `TabBar.renderMenu()`.
- Compare against the new item list, prune stale nodes, and reuse matching nodes.
- Re-order nodes in-place using `appendChild` in the new iteration order.
- Clear only the internal contents of reused elements (`itemEl.empty()`) and rebuild them.

**Tech Stack:** TypeScript, Vanilla DOM API.

## Global Constraints
- Node.js version floor: >=24.
- Do not use `console.log` in production code.
- No `!important` rules in CSS changes.
- Ensure typecheck, lint, and tests remain green.

---

### Task 1: DOM reconciliation in `TabBar.ts`

**Files:**
- Modify: `src/ui/chat/tabs/TabBar.ts`

**Interfaces:**
- Consumes: None
- Produces: Reconciled `renderMenu` and new `renderOrUpdateMenuItem` helper

- [ ] **Step 1: Refactor `renderMenu` and create `renderOrUpdateMenuItem`**

Replace `renderMenu` and `renderMenuItem` inside `src/ui/chat/tabs/TabBar.ts` with the new implementation.

Replace lines 136-222 (or the equivalent area for `renderMenu` and `renderMenuItem`):
```typescript
  private renderMenu(activeId: TabId): void {
    let menuEl = this.containerEl.querySelector('.pivi-tab-switcher-menu') as HTMLElement;
    if (!menuEl) {
      menuEl = this.containerEl.createDiv({ cls: 'pivi-tab-switcher-menu' });
      menuEl.setAttribute('role', 'menu');
      menuEl.addEventListener('click', event => event.stopPropagation());
    } else {
      menuEl.empty();
    }

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
    // ... old renderMenuItem implementation ...
  }
```

Replace with:
```typescript
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
    if (!itemEl) {
      itemEl = menuEl.createDiv({ cls: 'pivi-tab-switcher-item' });
      itemEl.setAttribute('data-tab-id', item.id);
    } else {
      itemEl.empty();
      menuEl.appendChild(itemEl);
    }

    const isExiting = this.exitingTabIds.has(item.id);
    itemEl.className = `pivi-tab-switcher-item ${item.id === activeId ? 'is-active' : ''} ${item.needsAttention ? 'needs-attention' : ''} ${item.isArchived ? 'is-archived' : ''} ${isExiting ? 'is-exiting' : ''}`;
    itemEl.setAttribute('role', 'menuitem');
    itemEl.setAttribute('tabindex', '0');
    itemEl.setAttribute('aria-label', item.title);
    setTabTooltip(itemEl, item.title);

    itemEl.createSpan({
      cls: `pivi-tab-switcher-dot ${this.getDotClass(item)}`,
    });
    itemEl.createSpan({ cls: 'pivi-tab-switcher-item-title', text: item.title });

    const archiveEl = itemEl.createSpan({ cls: 'pivi-tab-switcher-archive' });
    setIcon(archiveEl, item.isArchived ? 'archive-restore' : 'archive');
    archiveEl.setAttribute('aria-label', item.isArchived ? `Restore ${item.title}` : `Archive ${item.title}`);
    setTabTooltip(archiveEl, item.isArchived ? `Restore ${item.title}` : `Archive ${item.title}`);
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
        const activeWin = this.containerEl.ownerDocument.defaultView ?? window;
        activeWin.setTimeout(() => {
          this.exitingTabIds.delete(currentItem.id);
          this.callbacks.onTabArchive(currentItem.id);
        }, 200);
      }
    });

    if (item.canClose) {
      const closeEl = itemEl.createSpan({ cls: 'pivi-tab-switcher-close' });
      setIcon(closeEl, 'x');
      closeEl.setAttribute('aria-label', `Close ${item.title}`);
      setTabTooltip(closeEl, `Close ${item.title}`);
      closeEl.setAttribute('role', 'button');
      closeEl.addEventListener('click', (event) => {
        event.stopPropagation();
        const currentItem = this.items.find(it => it.id === item.id);
        if (!currentItem) return;

        if (itemEl.classList.contains('is-exiting')) return;
        this.exitingTabIds.add(currentItem.id);
        itemEl.classList.add('is-exiting');
        const activeWin = this.containerEl.ownerDocument.defaultView ?? window;
        activeWin.setTimeout(() => {
          this.exitingTabIds.delete(currentItem.id);
          this.callbacks.onTabClose(currentItem.id);
        }, 200);
      });
    }

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
```

- [ ] **Step 2: Run verification and compile**

Run: `npm run typecheck && npm run test`
Expected: Passes successfully.

- [ ] **Step 3: Commit changes**

```bash
git add src/ui/chat/tabs/TabBar.ts
git commit -m "fix: reconcile tab items in-place to prevent background switcher flicker"
```

---

### Task 2: Build validation & local deployment

**Files:**
- None

- [ ] **Step 1: Production bundle build**

Run: `npm run build && obsidian reload`
Expected: Compiles cleanly and deploys to Obsidian vault.

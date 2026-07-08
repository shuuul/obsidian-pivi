# Implementation Plan: Tab Switcher Active Tab Exit Optimization

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ensure that when the active tab is closed/archived, the view switches to the fallback tab immediately on click. The exiting tab item in the dropdown should continue its transition, and the switcher control's title text should animate smoothly. Clear pending timeouts and use fresh status properties to avoid stale closures.

**Tech Stack:** TypeScript, CSS, Vanilla DOM API.

## Global Constraints
- Node.js version floor: >=24.
- Do not use `console.log` in production code.
- No `!important` rules in CSS changes.
- Ensure typecheck, lint, and tests remain green.

---

### Task 1: Immediate Active Tab Switch and Title Transition

**Files:**
- Modify: `src/ui/chat/tabs/TabBar.ts`
- Modify: `src/styles/components/tabs.css`

- [ ] **Step 1: Declare timeout tracking fields in `TabBar.ts`**

Locate the `TabBar` class properties. Declare `titleTimeoutId` and `exitTimeouts` to safely track timeouts:
```typescript
export class TabBar {
  private containerEl: HTMLElement;
  private callbacks: TabBarCallbacks;
  private items: TabBarItem[] = [];
  private isOpen = false;
  private exitingTabIds = new Set<TabId>();
  private titleTimeoutId: any = null;
  private exitTimeouts = new Map<TabId, any>();
```

- [ ] **Step 2: Update click handlers in `renderOrUpdateMenuItem` to switch active tab immediately using `currentItem.isActive`**

Replace the event listeners inside the `isNew` block of `renderOrUpdateMenuItem` in `src/ui/chat/tabs/TabBar.ts` with updated versions that use `currentItem.isActive` and track the timeouts:

For `archiveEl` click listener:
```typescript
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
```

For `closeEl` click listener:
```typescript
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
```

- [ ] **Step 3: Update `renderControl` title transition with timeout cancellation**

Update the `titleEl` handling in `TabBar.ts` `renderControl` to safely cancel any pending timeouts:
```typescript
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
```

- [ ] **Step 4: Update `destroy()` to clear all pending timeouts**

Update `destroy()` in `src/ui/chat/tabs/TabBar.ts` to cleanly clear timeouts:
```typescript
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
```

- [ ] **Step 5: Update CSS transitions in `src/styles/components/tabs.css`**

Add transition styles for `.pivi-tab-switcher-title` in `src/styles/components/tabs.css`:
```css
.pivi-tab-switcher-title {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  transition: opacity 0.12s ease;
  opacity: 1;
}

.pivi-tab-switcher-title.is-updating {
  opacity: 0;
}
```
Locate the existing definition of `.pivi-tab-switcher-title` around line 88 and split it from `.pivi-tab-switcher-item-title` to apply the transition uniquely to the switcher control title.

- [ ] **Step 6: Run verification**

Run: `npm run typecheck && npm run test`
Ensure everything compiles cleanly and all unit tests pass.

- [ ] **Step 7: Git commit**

```bash
git add src/ui/chat/tabs/TabBar.ts src/styles/components/tabs.css
git commit -m "fix: switch active tab immediately using isActive, cancel title timeout race conditions, and add title transition"
```

---

### Task 2: Build validation & local deployment

**Files:**
- None

- [ ] **Step 1: Production bundle build**

Run: `npm run build && obsidian reload`
Expected: Compiles cleanly and deploys to Obsidian vault.

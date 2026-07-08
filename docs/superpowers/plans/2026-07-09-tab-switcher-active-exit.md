# Implementation Plan: Tab Switcher Active Tab Exit Optimization

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ensure that when the active tab is closed/archived, the view switches to the fallback tab immediately on click. The exiting tab item in the dropdown should continue its transition, and the switcher control's title text should animate smoothly.

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

- [ ] **Step 1: Update click handlers in `src/ui/chat/tabs/TabBar.ts` to switch active tab immediately**

In `src/ui/chat/tabs/TabBar.ts`, locate `renderOrUpdateMenuItem`. Update the `archiveEl` click listener and the `closeEl` click listener to immediately switch to a fallback tab if the tab being closed/archived is the currently active tab:

For `archiveEl` click listener (lines 244-266 approx):
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
          if (currentItem.id === activeId) {
            const fallbackItem = this.items.find(it => it.id !== currentItem.id && !it.isArchived)
                              ?? this.items.find(it => it.id !== currentItem.id);
            if (fallbackItem) {
              this.callbacks.onTabClick(fallbackItem.id);
            }
          }

          const activeWin = this.containerEl.ownerDocument.defaultView ?? window;
          activeWin.setTimeout(() => {
            this.exitingTabIds.delete(currentItem.id);
            this.callbacks.onTabArchive(currentItem.id);
          }, 200);
        }
      });
```

For `closeEl` click listener (lines 304-322 approx):
```typescript
        closeEl.addEventListener('click', (event) => {
          event.stopPropagation();
          const currentItem = this.items.find(it => it.id === item.id);
          if (!currentItem) return;

          if (itemEl.classList.contains('is-exiting')) return;
          this.exitingTabIds.add(currentItem.id);
          itemEl.classList.add('is-exiting');

          // If closing the active tab, switch view immediately
          if (currentItem.id === activeId) {
            const fallbackItem = this.items.find(it => it.id !== currentItem.id && !it.isArchived)
                              ?? this.items.find(it => it.id !== currentItem.id);
            if (fallbackItem) {
              this.callbacks.onTabClick(fallbackItem.id);
            }
          }

          const activeWin = this.containerEl.ownerDocument.defaultView ?? window;
          activeWin.setTimeout(() => {
            this.exitingTabIds.delete(currentItem.id);
            this.callbacks.onTabClose(currentItem.id);
          }, 200);
        });
```

- [ ] **Step 2: Add Title Transition animation in `TabBar.ts` `renderControl`**

In `src/ui/chat/tabs/TabBar.ts`, locate `renderControl`. Update updating `titleEl.textContent` to fade out, change, and fade in:
```typescript
      const titleEl = triggerEl.querySelector('.pivi-tab-switcher-title') as HTMLElement;
      if (titleEl) {
        if (titleEl.textContent && titleEl.textContent !== activeItem.title) {
          titleEl.classList.add('is-updating');
          const activeWin = this.containerEl.ownerDocument.defaultView ?? window;
          activeWin.setTimeout(() => {
            titleEl.textContent = activeItem.title;
            titleEl.classList.remove('is-updating');
          }, 120);
        } else {
          titleEl.textContent = activeItem.title;
        }
      }
```

- [ ] **Step 3: Update CSS transitions in `src/styles/components/tabs.css`**

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

- [ ] **Step 4: Run verification**

Run: `npm run typecheck && npm run test`
Ensure everything compiles cleanly and all unit tests pass.

- [ ] **Step 5: Git commit**

```bash
git add src/ui/chat/tabs/TabBar.ts src/styles/components/tabs.css
git commit -m "fix: switch active tab immediately and animate title text transition"
```

---

### Task 2: Build validation & local deployment

**Files:**
- None

- [ ] **Step 1: Production bundle build**

Run: `npm run build && obsidian reload`
Expected: Compiles cleanly and deploys to Obsidian vault.

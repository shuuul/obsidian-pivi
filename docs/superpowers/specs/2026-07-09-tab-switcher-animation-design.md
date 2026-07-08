# Design Spec: Tab Switcher Animation Optimization

This specification outlines the changes required to optimize the tab switcher's animation in the Pivi Obsidian plugin, eliminating the screen flicker/flash when tabs are closed or archived, and introducing a smooth fade-out and collapse transition.

---

## 🎯 Goals & Success Criteria

1. **Flicker-Free UI Refresh**: When the list of tabs changes (e.g. archiving/closing a tab, or opening a new chat), the active dropdown menu `pivi-tab-switcher-menu` must not flash, pop, or re-run its slide-in entry animation if it is already open.
2. **Smooth Tab Removal / Archiving Transition**: When a tab is closed or archived, it should smoothly fade and shrink vertically (collapse) before disappearing from the UI.
3. **No `!important` CSS rules**: All animation overrides must use standard CSS specificity.
4. **Reliability & Simplicity**: The design must not introduce complex virtual DOM diffing logic.

---

## 🛠️ Architecture & Detailed Design

We will achieve this through three coordinated changes:

### 1. In-place DOM updates in `TabBar.ts`

Currently, `TabBar.render()` begins by clearing all children:
```typescript
this.containerEl.empty();
```
This tears down the trigger control and the dropdown menu. When recreated, the browser re-evaluates the entry keyframes, causing a visual flash.

We will refactor the rendering flow to update existing nodes when possible:
1. **Control Button (`pivi-tab-switcher-control`)**: Look for an existing control element. If not found, create it once. If it exists, update its dynamic attributes (such as the text content of the title element, the status dot class, and accessibility attributes like `aria-expanded` and `aria-label`).
2. **Dropdown Menu (`pivi-tab-switcher-menu`)**:
   - If `this.isOpen` is true:
     - Check if `.pivi-tab-switcher-menu` already exists.
     - If not, create it. If it does, retain the element (preventing re-trigger of entry animations).
     - Empty only the items list *inside* the menu (or rebuild it) rather than recreating the menu itself.
   - If `this.isOpen` is false:
     - Remove the menu element if it exists in the DOM.

### 2. Smooth Exit Animations via CSS in `tabs.css`

We will add a smooth height and opacity transition for tab items. By targeting `.pivi-tab-switcher-item.is-exiting`, the specificity naturally overrides the base item properties without using `!important`.

```css
.pivi-tab-switcher-item {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto auto auto;
  align-items: center;
  gap: 8px;
  min-height: 28px;
  max-height: 40px; /* Safe upper bound for single items */
  padding: 0 7px;
  border-radius: 9px;
  color: var(--text-normal);
  font-size: var(--font-ui-small);
  cursor: pointer;
  transition: 
    opacity 0.2s ease, 
    max-height 0.2s cubic-bezier(0.4, 0, 0.2, 1), 
    padding 0.2s ease, 
    min-height 0.2s ease, 
    transform 0.2s ease;
  overflow: hidden;
  will-change: opacity, max-height, transform;
}

.pivi-tab-switcher-item.is-exiting {
  opacity: 0;
  max-height: 0;
  min-height: 0;
  padding-top: 0;
  padding-bottom: 0;
  pointer-events: none;
  transform: scaleY(0);
}
```

### 3. Delayed Action Callbacks in `TabBar.ts`

To let the CSS animation run before the tab state changes:
1. In the click handler for `closeEl` and `archiveEl`, before calling the callback, we add the `is-exiting` class to the tab's menu item DOM element (`itemEl`).
2. Set a timeout of `200ms` (matching the CSS transition duration).
3. Once the timeout completes, execute the actual callback (`onTabClose` or `onTabArchive`).
4. Since the state is updated, `updateTabBar()` will fire, sending the updated item list to `TabBar.update()`, which renders without the removed item.
5. In addition, we will remove redundant manual calls to `this.render()` inside `onTabArchive` and `onTabClick` handlers within `TabBar.ts`, letting the debounced requestAnimationFrame update from `PiviView` handle rendering.

---

## 🧪 Testing Plan

- **Manual Verification**:
  1. Open multiple tabs.
  2. Click "Archive" on an open tab. Verify that the tab collapses smoothly and moves to the "Archived" section without the dropdown menu flashing or closing.
  3. Click "Close" on a tab. Verify that the tab collapses and disappears smoothly.
  4. Ensure that the active tab's switcher control updates its text without any visual jumps.
- **Unit Testing**:
  - Run the existing suite (`npm run test`) to verify all tab state management and view registration tests remain green.

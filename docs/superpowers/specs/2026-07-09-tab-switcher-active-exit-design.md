# Design Spec: Tab Switcher Active Tab Exit Optimization

This specification outlines the changes required to make active tab deletion and archiving seamless by immediately switching the active tab view on click and adding a smooth transition to the title text.

---

## 🎯 Goals & Success Criteria

1. **Immediate View Switch**: When closing or archiving the active tab, the active chat view and switcher control title must switch to the fallback tab immediately (on click).
2. **Smooth Exit Animation in Menu**: The deleted tab's item in the dropdown menu must continue its 200ms exit transition (fade and collapse) on top of the new active tab view.
3. **Smooth Title Text Transition**: The title text of the switcher control must fade out, update, and fade in smoothly (120ms transition) when the active tab changes.
4. **Green tests**: All unit tests must pass cleanly.

---

## 🛠️ Detailed Design

### 1. Immediate Active Tab Handoff on Click in `TabBar.ts`

In `TabBar.renderOrUpdateMenuItem()`, inside the click listeners for `closeEl` and `archiveEl`:
- If `currentItem.id === activeId` (the tab being removed is active):
  - Find a fallback tab from `this.items` that is not the current tab.
  - Call `this.callbacks.onTabClick(fallbackItem.id)` immediately.
- Mark the tab as exiting (`this.exitingTabIds.add(currentItem.id)`) and add the class `is-exiting`.
- Trigger the timeout of 200ms to call `onTabClose`/`onTabArchive` as before.

This ensures the background view switches immediately, while the item's transition runs in the background.

### 2. Title Text Transition in `TabBar.ts` and `tabs.css`

1. **CSS Transition**:
   ```css
   .pivi-tab-switcher-title {
     transition: opacity 0.12s ease;
     opacity: 1;
   }
   .pivi-tab-switcher-title.is-updating {
     opacity: 0;
   }
   ```
2. **TypeScript Trigger**:
   In `TabBar.renderControl()`:
   - When updating `titleEl.textContent`:
     - If the text exists and is different from `activeItem.title`, add the class `is-updating`.
     - Use a timeout of 120ms to update the text and remove `is-updating`.
     - Otherwise, set the text directly.

---

## 🧪 Testing Plan

- **Unit Testing**:
  - Run `npm run test` and verify that the `TabBar` test suite successfully completes.

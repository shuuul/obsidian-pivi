# Design Spec: Tab Switcher Background Flicker Fix

This specification outlines the changes required to eliminate the flicker of remaining (background) tabs in the dropdown list when another tab is closed or archived.

---

## 🎯 Goals & Success Criteria

1. **Flicker-Free Dropdown Items**: When a tab is removed, the remaining items in the switcher list must not flicker or flash.
2. **Proper DOM Reconciliation**: Reuse existing `.pivi-tab-switcher-item` elements in the DOM instead of destroying and recreating them on every update.
3. **Green tests**: Ensure all unit tests in `TabBar.test.ts` and the main suite pass.

---

## 🛠️ Detailed Design

Currently, `TabBar.renderMenu()` clears the dropdown menu using:
```typescript
menuEl.empty();
```
This forces all tab item DOM elements to be destroyed and rebuilt, causing a flash.

We will refactor this to:
1. **Query & Map**: Query the existing tab items in the DOM and keep them in a Map keyed by `TabId` (via `data-tab-id` attribute).
2. **Prune**: Compare the existing elements against the new list of tabs, removing any elements whose tab IDs are no longer present.
3. **Re-use & Sort**: Loop through the new items list. If an item already has a DOM element, we call `.empty()` on the specific item element (to clear its interior children, which is flicker-free) and then call `menuEl.appendChild(itemEl)`. In the browser, appending an existing child moves it to the end, naturally sorting the list in-place.
4. **Re-bind**: Create the interior spans (dot, title, buttons) and bind event listeners fresh in each render loop.

---

## 🧪 Testing Plan

- **Unit Testing**:
  - Run `npm run test` and verify that the `TabBar` test suite successfully completes.

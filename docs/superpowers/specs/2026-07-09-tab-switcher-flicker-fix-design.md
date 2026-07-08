# Design Spec: Tab Switcher Background Flicker Fix

This specification outlines the changes required to eliminate the flicker of remaining (background) tabs in the dropdown list and the main view when another tab is closed or archived.

---

## 🎯 Goals & Success Criteria

1. **Flicker-Free Dropdown Items**: When a tab is removed, the remaining items in the switcher list must not flicker or flash.
2. **Proper DOM Reconciliation**: 
   - Reuse existing `.pivi-tab-switcher-item` elements in the DOM instead of destroying and recreating them.
   - Reuse their child elements (spans, buttons, text nodes) in-place instead of calling `.empty()` on the item container.
3. **Avoid Redundant AppendChild Calls**: Ensure `PiviView.ts` only appends the nav row and tab bar elements to their parents if they are not already attached to them, preventing layout reflow flashes.
4. **Green tests**: Ensure all unit tests in `TabBar.test.ts` and the main suite pass.

---

## 🛠️ Detailed Design

### 1. Reusing Tab Item Child Elements in `TabBar.ts`

Instead of calling `itemEl.empty()` for reused elements, we will check if the item is newly created (`isNew`).
- **If `isNew`**: We create the spans (dot, title, archive button, close button) and bind their click/keydown listeners once.
- **On updates**: We locate the elements (using class names) and update their text and class attributes.
- **Archive Button**: Only clear its interior SVG icon and regenerate it when needed, keeping the wrapper span and its click listener intact.
- **Close Button**: Re-use if it exists; create if needed; remove if no longer needed.

### 2. Parent-Check before AppendChild in `PiviView.ts`

We will update `updateNavRowLocation` to check the `parentElement` of the elements before appending them:
```typescript
  private updateNavRowLocation(): void {
    if (!this.tabBarContainerEl) return;

    const isHeaderMode = this.plugin.settings.tabBarPosition === 'header';

    if (isHeaderMode) {
      if (this.headerEl && this.tabBarContainerEl.parentElement !== this.headerEl) {
        this.headerEl.appendChild(this.tabBarContainerEl);
      }
      this.navRowContent?.remove();
    } else {
      const activeTab = this.tabManager?.getActiveTab();
      if (activeTab && this.navRowContent) {
        if (this.tabBarContainerEl.parentElement !== this.navRowContent) {
          this.navRowContent.appendChild(this.tabBarContainerEl);
        }
        if (this.navRowContent.parentElement !== activeTab.dom.messagesBottomControlsEl) {
          activeTab.dom.messagesBottomControlsEl.appendChild(this.navRowContent);
        }
      }
    }
  }
```

---

## 🧪 Testing Plan

- **Unit Testing**:
  - Run `npm run test` and verify that the `TabBar` test suite successfully completes.

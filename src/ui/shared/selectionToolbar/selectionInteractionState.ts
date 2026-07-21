export interface SelectionInteractionState {
  readonly isPointerDown: boolean;
  readonly isKeyboardSelection: boolean;
  readonly isContextOpening: boolean;
  onPointerDown(): void;
  onPointerUp(): void;
  onKeyDown(event: KeyboardEvent): void;
  onContextMenu(): void;
  clearContextOpening(): void;
}

const KEYBOARD_SELECTION_KEYS = new Set([
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'ArrowDown',
  'Home',
  'End',
  'PageUp',
  'PageDown',
]);

export function createSelectionInteractionState(): SelectionInteractionState {
  let isPointerDown = false;
  let isKeyboardSelection = false;
  let isContextOpening = false;

  return {
    get isPointerDown() {
      return isPointerDown;
    },
    get isKeyboardSelection() {
      return isKeyboardSelection;
    },
    get isContextOpening() {
      return isContextOpening;
    },
    onPointerDown() {
      isPointerDown = true;
      isKeyboardSelection = false;
    },
    onPointerUp() {
      isPointerDown = false;
    },
    onKeyDown(event: KeyboardEvent) {
      isPointerDown = false;
      if (event.shiftKey && KEYBOARD_SELECTION_KEYS.has(event.key)) {
        isKeyboardSelection = true;
      }
    },
    onContextMenu() {
      isContextOpening = true;
    },
    clearContextOpening() {
      isContextOpening = false;
    },
  };
}

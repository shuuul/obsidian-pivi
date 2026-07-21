import type { Extension } from '@codemirror/state';
import type { EditorView, PluginValue, ViewUpdate } from '@codemirror/view';
import { ViewPlugin } from '@codemirror/view';

import { getActiveWindow } from '@/ui/shared/dom';

import { getSelectionRect } from './selectionGeometry';
import type { EditorSelectionSnapshot } from './types';

export interface SelectionToolbarPluginHandlers {
  onSelection: (snapshot: EditorSelectionSnapshot) => void;
  onSelectionCleared: () => void;
  /** When true, suppress hide while overlay focused (optional; default false) */
  isOverlayFocused?: () => boolean;
  shouldSuppressForPointerDown?: () => boolean;
  getInteractionState: () => {
    isPointerDown: boolean;
    isKeyboardSelection: boolean;
    isContextOpening: boolean;
  };
  clearContextOpening?: () => void;
}

interface SelectionSnapshot {
  from: number;
  to: number;
  text: string;
}

export function createSelectionToolbarPluginClass(
  handlers: SelectionToolbarPluginHandlers,
): new (view: EditorView) => PluginValue {
  class SelectionToolbarPlugin implements PluginValue {
    private lastSelection: SelectionSnapshot | null = null;
    private pendingSelection: SelectionSnapshot | null = null;
    private animationFrame: number | null = null;

    constructor(private readonly view: EditorView) {}

    update(update: ViewUpdate): void {
      const selection = update.state.selection.main;
      this.pendingSelection = {
        from: selection.from,
        to: selection.to,
        text: update.state.doc.sliceString(selection.from, selection.to),
      };

      if (handlers.shouldSuppressForPointerDown?.()) {
        return;
      }

      const interactionState = handlers.getInteractionState();
      if (
        interactionState.isContextOpening
        && this.pendingSelection.from + 1 === this.pendingSelection.to
        && this.pendingSelection.text === '\n'
      ) {
        handlers.clearContextOpening?.();
        return;
      }

      if (!update.selectionSet) {
        if (handlers.isOverlayFocused?.()) {
          return;
        }
        if (this.pendingSelection.from === this.pendingSelection.to) {
          this.clearSelection();
        }
        return;
      }

      if (selection.empty) {
        this.clearSelection();
        return;
      }

      if (
        this.lastSelection
        && this.lastSelection.from === this.pendingSelection.from
        && this.lastSelection.to === this.pendingSelection.to
        && this.lastSelection.text === this.pendingSelection.text
      ) {
        return;
      }

      this.scheduleSelectionNotification();
    }

    destroy(): void {
      if (this.animationFrame !== null) {
        getActiveWindow(this.view.dom).cancelAnimationFrame(this.animationFrame);
        this.animationFrame = null;
      }
      handlers.onSelectionCleared();
    }

    private clearSelection(): void {
      this.lastSelection = null;
      handlers.onSelectionCleared();
    }

    private scheduleSelectionNotification(): void {
      if (this.animationFrame !== null) {
        getActiveWindow(this.view.dom).cancelAnimationFrame(this.animationFrame);
      }
      this.animationFrame = getActiveWindow(this.view.dom).requestAnimationFrame(() => {
        this.animationFrame = null;
        const pending = this.pendingSelection;
        if (!pending || pending.from === pending.to) {
          return;
        }

        const rect = getSelectionRect(this.view);
        if (!rect) {
          return;
        }

        this.lastSelection = {
          from: pending.from,
          to: pending.to,
          text: pending.text,
        };

        handlers.onSelection({
          from: pending.from,
          to: pending.to,
          text: pending.text,
          rect,
          editorView: this.view,
        });
      });
    }
  }

  return SelectionToolbarPlugin;
}

export function createSelectionToolbarViewPlugin(
  handlers: SelectionToolbarPluginHandlers,
): Extension {
  return ViewPlugin.fromClass(createSelectionToolbarPluginClass(handlers));
}

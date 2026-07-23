import type { Extension } from '@codemirror/state';
import type { EditorView, PluginValue, ViewUpdate } from '@codemirror/view';
import { ViewPlugin } from '@codemirror/view';
import type { Editor } from 'obsidian';
import { editorInfoField } from 'obsidian';

import { getActiveWindow } from '@/ui/shared/dom';

import { getSelectionRect } from './selectionGeometry';
import type { EditorSelectionSnapshot } from './types';

export interface SelectionToolbarPluginHandlers {
  onSelection: (snapshot: EditorSelectionSnapshot) => void;
  onSelectionCleared: (editorView: EditorView) => void;
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

interface RefreshableSelectionToolbarPlugin {
  refreshSelection(force: boolean): void;
  resetSelection(): void;
  captureSelection(editor: Editor): EditorSelectionSnapshot | null;
  readonly ownerDocument: Document;
}

const activeSelectionToolbarPlugins = new Set<RefreshableSelectionToolbarPlugin>();

/** Captures the current CM selection for an Obsidian editor, independent of toolbar visibility. */
export function captureEditorSelectionSnapshot(
  editor: Editor,
): EditorSelectionSnapshot | null {
  for (const plugin of activeSelectionToolbarPlugins) {
    const snapshot = plugin.captureSelection(editor);
    if (snapshot) {
      return snapshot;
    }
  }
  return null;
}

/** Re-checks CM selections after pointer state changes that do not create a transaction. */
export function refreshSelectionToolbarViews(
  ownerDocument?: Document,
  force = false,
): void {
  for (const plugin of activeSelectionToolbarPlugins) {
    if (!ownerDocument || plugin.ownerDocument === ownerDocument) {
      plugin.refreshSelection(force);
    }
  }
}

/** Clears selection identity after a surface is dismissed so reselecting it can notify again. */
export function resetSelectionToolbarViews(): void {
  for (const plugin of activeSelectionToolbarPlugins) {
    plugin.resetSelection();
  }
}

export function createSelectionToolbarPluginClass(
  handlers: SelectionToolbarPluginHandlers,
): new (view: EditorView) => PluginValue {
  class SelectionToolbarPlugin implements PluginValue {
    private lastSelection: SelectionSnapshot | null = null;
    private pendingSelection: SelectionSnapshot | null = null;
    private animationFrame: number | null = null;
    private selectionSuppressed = false;

    constructor(private readonly view: EditorView) {
      activeSelectionToolbarPlugins.add(this);
    }

    get ownerDocument(): Document {
      return this.view.dom.ownerDocument;
    }

    update(update: ViewUpdate): void {
      const selection = update.state.selection.main;
      this.pendingSelection = {
        from: selection.from,
        to: selection.to,
        text: update.state.doc.sliceString(selection.from, selection.to),
      };

      if (handlers.shouldSuppressForPointerDown?.()) {
        this.selectionSuppressed = true;
        return;
      }
      this.selectionSuppressed = false;

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
      activeSelectionToolbarPlugins.delete(this);
      if (this.animationFrame !== null) {
        getActiveWindow(this.view.dom).cancelAnimationFrame(this.animationFrame);
        this.animationFrame = null;
      }
      handlers.onSelectionCleared(this.view);
    }

    refreshSelection(force: boolean): void {
      if (!force && !this.selectionSuppressed) {
        return;
      }
      this.selectionSuppressed = false;
      const selection = this.view.state.selection.main;
      this.pendingSelection = {
        from: selection.from,
        to: selection.to,
        text: this.view.state.doc.sliceString(selection.from, selection.to),
      };
      if (selection.empty) {
        this.clearSelection();
        return;
      }
      this.scheduleSelectionNotification();
    }

    resetSelection(): void {
      if (this.animationFrame !== null) {
        getActiveWindow(this.view.dom).cancelAnimationFrame(this.animationFrame);
        this.animationFrame = null;
      }
      this.lastSelection = null;
      this.pendingSelection = null;
      this.selectionSuppressed = false;
    }

    captureSelection(editor: Editor): EditorSelectionSnapshot | null {
      const owningEditor = editorInfoField
        ? this.view.state.field(editorInfoField, false)?.editor
        : undefined;
      if (owningEditor !== editor) {
        return null;
      }
      const selection = this.view.state.selection.main;
      if (selection.empty) {
        return null;
      }
      const rect = getSelectionRect(this.view);
      if (!rect) {
        return null;
      }
      return {
        from: selection.from,
        to: selection.to,
        text: this.view.state.doc.sliceString(selection.from, selection.to),
        rect,
        editorView: this.view,
        editor,
      };
    }

    private clearSelection(): void {
      this.lastSelection = null;
      handlers.onSelectionCleared(this.view);
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

        const editor = editorInfoField
          ? this.view.state.field(editorInfoField, false)?.editor
          : undefined;
        handlers.onSelection({
          from: pending.from,
          to: pending.to,
          text: pending.text,
          rect,
          editorView: this.view,
          editor,
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

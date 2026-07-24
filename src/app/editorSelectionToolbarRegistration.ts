import type { Plugin } from 'obsidian';
import { ItemView, MarkdownView } from 'obsidian';

import { inlineEditDiffReviewField } from '@/app/ui/inlineEditSurface/inlineEditDiffReviewField';
import { inlineEditSurfaceField } from '@/app/ui/inlineEditSurface/inlineEditSurfaceField';
import { getActiveDocument, getActiveWindow } from '@/ui/shared/dom';
import {
  createFloatingOverlay,
  type FloatingOverlayHandle,
} from '@/ui/shared/selectionToolbar/floatingOverlay';
import {
  clampOverlayPosition,
  getSelectionRect,
} from '@/ui/shared/selectionToolbar/selectionGeometry';
import {
  createSelectionInteractionState,
  type SelectionInteractionState,
} from '@/ui/shared/selectionToolbar/selectionInteractionState';
import {
  createSelectionToolbarViewPlugin,
  refreshSelectionToolbarViews,
  resetSelectionToolbarViews,
} from '@/ui/shared/selectionToolbar/selectionToolbarPlugin';
import type { EditorSelectionSnapshot } from '@/ui/shared/selectionToolbar/types';

const OVERLAY_CLASS = 'pivi-selection-toolbar-overlay';

type SelectionShowCallback = (snapshot: EditorSelectionSnapshot) => void;
type SelectionDismissCallback = () => void;

export type RegisterEditorSelectionToolbarOptions = {
  /** True when Pivi's selected-text toolbar is enabled (Settings → Toolbar). */
  readonly isToolbarEnabled: () => boolean;
  /** True when Note Toolbar's selected-text toolbar is active and should own the surface. */
  readonly shouldYieldToNoteToolbar: () => boolean;
};

export class SelectionToolbarHost {
  private currentSnapshot: EditorSelectionSnapshot | null = null;
  private readonly showCallbacks = new Set<SelectionShowCallback>();
  private readonly dismissCallbacks = new Set<SelectionDismissCallback>();
  private overlay: FloatingOverlayHandle;
  private ownerDocument: Document;
  private ownerWindow: Window;
  private scrollListenerAttached = false;

  constructor(ownerDocument: Document) {
    this.ownerDocument = ownerDocument;
    this.ownerWindow = getActiveWindow(ownerDocument.documentElement);
    this.overlay = this.createOverlay(ownerDocument);
  }

  private createOverlay(ownerDocument: Document): FloatingOverlayHandle {
    return createFloatingOverlay({
      ownerDocument: ownerDocument,
      className: OVERLAY_CLASS,
      onDismiss: () => {
        this.currentSnapshot = null;
        this.overlay.hide();
        resetSelectionToolbarViews();
        this.notifyDismissed();
      },
    });
  }

  onShow(callback: SelectionShowCallback): () => void {
    this.showCallbacks.add(callback);
    return () => {
      this.showCallbacks.delete(callback);
    };
  }

  onDismiss(callback: SelectionDismissCallback): () => void {
    this.dismissCallbacks.add(callback);
    return () => {
      this.dismissCallbacks.delete(callback);
    };
  }

  getOverlayElement(): HTMLElement {
    return this.overlay.element;
  }

  getCurrentSnapshot(): EditorSelectionSnapshot | null {
    return this.currentSnapshot;
  }

  handleSelection(snapshot: EditorSelectionSnapshot): void {
    this.ensureOwnerDocument(snapshot.editorView.dom.ownerDocument);
    this.currentSnapshot = snapshot;
    this.overlay.show();
    this.repositionOverlay();
    this.ensureScrollListener();
    for (const callback of this.showCallbacks) {
      callback(snapshot);
    }
  }

  handleSelectionCleared(editorView?: EditorSelectionSnapshot['editorView']): void {
    if (editorView && this.currentSnapshot?.editorView !== editorView) {
      return;
    }
    this.currentSnapshot = null;
    this.overlay.hide();
    this.notifyDismissed();
  }

  dismissOverlay(): void {
    this.currentSnapshot = null;
    this.overlay.hide();
    resetSelectionToolbarViews();
    this.notifyDismissed();
  }

  hideOverlayPreservingSnapshot(): void {
    this.overlay.hide();
  }

  destroy(): void {
    this.removeScrollListener();
    this.showCallbacks.clear();
    this.dismissCallbacks.clear();
    this.currentSnapshot = null;
    this.overlay.destroy();
  }

  private notifyDismissed(): void {
    for (const callback of this.dismissCallbacks) {
      callback();
    }
  }

  private ensureOwnerDocument(ownerDocument: Document): void {
    if (ownerDocument === this.ownerDocument) {
      return;
    }
    this.removeScrollListener();
    this.overlay.destroy();
    this.ownerDocument = ownerDocument;
    this.ownerWindow = getActiveWindow(ownerDocument.documentElement);
    this.overlay = this.createOverlay(ownerDocument);
  }

  repositionOverlay(): void {
    const snapshot = this.currentSnapshot;
    if (!snapshot) {
      return;
    }

    const liveRect = getSelectionRect(snapshot.editorView);
    if (!liveRect) {
      this.dismissOverlay();
      return;
    }

    snapshot.rect = liveRect;
    const { left, top } = clampOverlayPosition({
      overlayWidth: this.overlay.element.offsetWidth,
      overlayHeight: this.overlay.element.offsetHeight,
      anchor: liveRect,
      viewport: {
        width: this.ownerWindow.innerWidth,
        height: this.ownerWindow.innerHeight,
      },
    });
    this.overlay.setPosition(left, top);
  }

  private ensureScrollListener(): void {
    if (this.scrollListenerAttached) {
      return;
    }
    this.ownerWindow.addEventListener('scroll', this.onScroll, true);
    this.scrollListenerAttached = true;
  }

  private removeScrollListener(): void {
    if (!this.scrollListenerAttached) {
      return;
    }
    this.ownerWindow.removeEventListener('scroll', this.onScroll, true);
    this.scrollListenerAttached = false;
  }

  private readonly onScroll = (): void => {
    if (!this.currentSnapshot) {
      return;
    }
    this.repositionOverlay();
  };
}

let selectionToolbarHost: SelectionToolbarHost | null = null;
let interactionState: SelectionInteractionState | null = null;

export function getSelectionToolbarHost(): SelectionToolbarHost | null {
  return selectionToolbarHost;
}

function resolveOwnerDocument(plugin: Plugin): Document {
  const workspace = plugin.app.workspace as {
    getActiveViewOfType?: (type: typeof ItemView) => ItemView | null;
  };
  const activeView = typeof workspace.getActiveViewOfType === 'function'
    ? workspace.getActiveViewOfType(ItemView)
    : null;
  return getActiveDocument(activeView?.containerEl ?? null);
}


export function registerEditorSelectionToolbar(
  plugin: Plugin,
  options: RegisterEditorSelectionToolbarOptions,
): void {
  const ownerDocument = resolveOwnerDocument(plugin);
  interactionState = createSelectionInteractionState();
  selectionToolbarHost = new SelectionToolbarHost(ownerDocument);

  const registeredDocuments = new Set<Document>();

  const registerDocumentListeners = (document: Document): void => {
    if (registeredDocuments.has(document)) {
      return;
    }
    registeredDocuments.add(document);
    plugin.registerDomEvent(document, 'pointerdown', () => {
      interactionState?.onPointerDown();
    }, true);
    plugin.registerDomEvent(document, 'pointerup', () => {
      interactionState?.onPointerUp();
      getActiveWindow(document.documentElement).requestAnimationFrame(() => {
        refreshSelectionToolbarViews(document);
      });
    }, true);
    plugin.registerDomEvent(document, 'pointercancel', () => {
      interactionState?.onPointerUp();
      refreshSelectionToolbarViews(document);
    }, true);
    plugin.registerDomEvent(document, 'keydown', (event: KeyboardEvent) => {
      interactionState?.onKeyDown(event);
    });
    plugin.registerDomEvent(document, 'contextmenu', () => {
      interactionState?.onContextMenu();
    });
  };

  registerDocumentListeners(ownerDocument);

  plugin.registerEvent(
    plugin.app.workspace.on('active-leaf-change', () => {
      const activeDocument = resolveOwnerDocument(plugin);
      interactionState?.onPointerUp();
      selectionToolbarHost?.handleSelectionCleared();
      registerDocumentListeners(activeDocument);
      getActiveWindow(activeDocument.documentElement).requestAnimationFrame(() => {
        refreshSelectionToolbarViews(activeDocument, true);
      });
    }),
  );

  // Keep inline-edit decoration fields in the base editor config so Obsidian
  // reconfigures (same-leaf file switches, mode toggles) cannot wipe them the
  // way a one-shot StateEffect.appendConfig install can.
  plugin.registerEditorExtension([
    inlineEditSurfaceField,
    inlineEditDiffReviewField,
  ]);

  plugin.registerEditorExtension(
    createSelectionToolbarViewPlugin({
      onSelection: (snapshot) => {
        const activeEditor = plugin.app.workspace.getActiveViewOfType(MarkdownView)?.editor;
        if (snapshot.editor && snapshot.editor !== activeEditor) {
          return;
        }
        if (!options.isToolbarEnabled() || options.shouldYieldToNoteToolbar()) {
          selectionToolbarHost?.handleSelectionCleared(snapshot.editorView);
          return;
        }
        selectionToolbarHost?.handleSelection(snapshot);
      },
      onSelectionCleared: (editorView) => {
        selectionToolbarHost?.handleSelectionCleared(editorView);
      },
      isOverlayFocused: () => {
        const host = selectionToolbarHost;
        if (!host) {
          return false;
        }
        const activeDocument = resolveOwnerDocument(plugin);
        return host.getOverlayElement().contains(activeDocument.activeElement);
      },
      shouldSuppressForPointerDown: () => interactionState?.isPointerDown ?? false,
      getInteractionState: () => ({
        isPointerDown: interactionState?.isPointerDown ?? false,
        isKeyboardSelection: interactionState?.isKeyboardSelection ?? false,
        isContextOpening: interactionState?.isContextOpening ?? false,
      }),
      clearContextOpening: () => {
        interactionState?.clearContextOpening();
      },
    }),
  );

  plugin.register(() => {
    selectionToolbarHost?.destroy();
    selectionToolbarHost = null;
    interactionState = null;
  });
}

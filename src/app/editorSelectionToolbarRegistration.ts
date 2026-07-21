import type { Plugin } from 'obsidian';
import { ItemView, MarkdownView } from 'obsidian';

import { getActiveDocument, getActiveWindow } from '@/ui/shared/dom';
import { createFloatingOverlay } from '@/ui/shared/selectionToolbar/floatingOverlay';
import { clampOverlayPosition } from '@/ui/shared/selectionToolbar/selectionGeometry';
import {
  createSelectionInteractionState,
  type SelectionInteractionState,
} from '@/ui/shared/selectionToolbar/selectionInteractionState';
import { createSelectionToolbarViewPlugin } from '@/ui/shared/selectionToolbar/selectionToolbarPlugin';
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
  private readonly overlay;
  private readonly ownerDocument: Document;
  private readonly ownerWindow: Window;
  private scrollListenerAttached = false;

  constructor(ownerDocument: Document) {
    this.ownerDocument = ownerDocument;
    this.ownerWindow = getActiveWindow(ownerDocument.documentElement);
    this.overlay = createFloatingOverlay({
      ownerDocument,
      className: OVERLAY_CLASS,
      onDismiss: () => {
        this.currentSnapshot = null;
        this.overlay.hide();
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
    this.currentSnapshot = snapshot;
    this.overlay.show();
    this.repositionOverlay();
    this.ensureScrollListener();
    for (const callback of this.showCallbacks) {
      callback(snapshot);
    }
  }

  handleSelectionCleared(): void {
    this.currentSnapshot = null;
    this.overlay.hide();
    this.notifyDismissed();
  }

  dismissOverlay(): void {
    this.currentSnapshot = null;
    this.overlay.hide();
    this.notifyDismissed();
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

  repositionOverlay(): void {
    const snapshot = this.currentSnapshot;
    if (!snapshot) {
      return;
    }

    const { left, top } = clampOverlayPosition({
      overlayWidth: this.overlay.element.offsetWidth,
      overlayHeight: this.overlay.element.offsetHeight,
      anchor: snapshot.rect,
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

function isSourceMode(plugin: Plugin): boolean {
  const markdownView = plugin.app.workspace.getActiveViewOfType(MarkdownView);
  return markdownView?.getState().source === true;
}

export function registerEditorSelectionToolbar(
  plugin: Plugin,
  options: RegisterEditorSelectionToolbarOptions,
): void {
  const ownerDocument = resolveOwnerDocument(plugin);
  interactionState = createSelectionInteractionState();
  selectionToolbarHost = new SelectionToolbarHost(ownerDocument);

  const registeredDocuments = new Set<Document>([ownerDocument]);

  const registerDocumentListeners = (document: Document): void => {
    if (registeredDocuments.has(document)) {
      return;
    }
    registeredDocuments.add(document);
    plugin.registerDomEvent(document, 'pointerdown', () => {
      interactionState?.onPointerDown();
    });
    plugin.registerDomEvent(document, 'pointerup', () => {
      interactionState?.onPointerUp();
    });
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
      registerDocumentListeners(resolveOwnerDocument(plugin));
    }),
  );

  plugin.registerEditorExtension(
    createSelectionToolbarViewPlugin({
      onSelection: (snapshot) => {
        if (!options.isToolbarEnabled() || options.shouldYieldToNoteToolbar()) {
          selectionToolbarHost?.handleSelectionCleared();
          return;
        }
        selectionToolbarHost?.handleSelection(snapshot);
      },
      onSelectionCleared: () => {
        selectionToolbarHost?.handleSelectionCleared();
      },
      isOverlayFocused: () => {
        const host = selectionToolbarHost;
        if (!host) {
          return false;
        }
        const activeDocument = resolveOwnerDocument(plugin);
        return host.getOverlayElement().contains(activeDocument.activeElement);
      },
      shouldSuppressForPointerDown: () => {
        if (!interactionState?.isPointerDown) {
          return false;
        }
        return !isSourceMode(plugin);
      },
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

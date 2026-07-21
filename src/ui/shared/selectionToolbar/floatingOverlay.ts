export type FloatingOverlayDismissReason = 'escape' | 'pointer-outside' | 'manual';

export interface FloatingOverlayHandle {
  readonly element: HTMLElement;
  setPosition(left: number, top: number): void;
  show(): void;
  hide(): void;
  destroy(): void;
  /** Increments on each show/replace; callers ignore stale async work */
  readonly generation: number;
}

export interface CreateFloatingOverlayOptions {
  ownerDocument: Document;
  className: string;
  onDismiss?: (reason: FloatingOverlayDismissReason) => void;
}

const HIDDEN_CLASS = 'pivi-selection-toolbar-overlay--hidden';

export function createFloatingOverlay(
  options: CreateFloatingOverlayOptions,
): FloatingOverlayHandle {
  const ownerDocument = options.ownerDocument as Document & {
    win: {
      createDiv: (args?: { cls?: string }) => HTMLElement;
    };
  };
  const element = ownerDocument.win.createDiv({
    cls: `${options.className} ${HIDDEN_CLASS}`,
  });
  options.ownerDocument.body.appendChild(element);

  let generation = 0;
  let isVisible = false;

  const dismiss = (reason: FloatingOverlayDismissReason): void => {
    if (!isVisible) {
      return;
    }
    hide();
    options.onDismiss?.(reason);
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      dismiss('escape');
    }
  };

  const onPointerDown = (event: PointerEvent): void => {
    const target = event.target;
    if (target && element.contains(target as Node)) {
      return;
    }
    dismiss('pointer-outside');
  };

  options.ownerDocument.addEventListener('keydown', onKeyDown, true);
  options.ownerDocument.addEventListener('pointerdown', onPointerDown, true);

  function setPosition(left: number, top: number): void {
    element.setCssProps({
      left: `${left}px`,
      top: `${top}px`,
    });
  }

  function show(): void {
    generation += 1;
    isVisible = true;
    element.removeClass(HIDDEN_CLASS);
  }

  function hide(): void {
    isVisible = false;
    element.addClass(HIDDEN_CLASS);
  }

  function destroy(): void {
    options.ownerDocument.removeEventListener('keydown', onKeyDown, true);
    options.ownerDocument.removeEventListener('pointerdown', onPointerDown, true);
    element.remove();
  }

  return {
    element,
    setPosition,
    show,
    hide,
    destroy,
    get generation() {
      return generation;
    },
  };
}

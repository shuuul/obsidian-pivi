import { type RefObject, useEffect, useRef } from 'react';

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'textarea:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

export type ModalInitialFocus = 'cancel' | 'first-field';

export interface UseModalLayerOptions {
  readonly open: boolean;
  readonly layerRef: RefObject<HTMLElement | null>;
  readonly onClose: () => void;
  readonly initialFocus?: ModalInitialFocus;
  readonly restoreFocus?: boolean;
}

function getFocusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
    .filter(element => !element.hasAttribute('disabled') && element.tabIndex !== -1);
}

function resolveInitialFocus(container: HTMLElement, mode: ModalInitialFocus): HTMLElement | null {
  const focusable = getFocusableElements(container);
  if (focusable.length === 0) return null;
  if (mode === 'first-field') {
    const field = focusable.find(element => (
      element.matches('textarea, input, select, [contenteditable="true"]')
    ));
    return field ?? focusable[0] ?? null;
  }
  const cancel = focusable.find(element => (
    element.matches('[data-modal-cancel], .pivi-button--danger ~ button, button:not(.pivi-button--danger)')
    && !element.matches('.pivi-button--danger')
  ));
  return cancel ?? focusable[0] ?? null;
}

/** Shared owner-realm focus lifecycle for React modal layers. */
export function useModalLayer({
  open,
  layerRef,
  onClose,
  initialFocus = 'cancel',
  restoreFocus = true,
}: UseModalLayerOptions): void {
  const triggerRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return undefined;
    const layer = layerRef.current;
    if (!layer) return undefined;
    const ownerDocument = layer.ownerDocument;
    triggerRef.current = ownerDocument.activeElement instanceof HTMLElement
      ? ownerDocument.activeElement
      : null;

    const focusTarget = resolveInitialFocus(layer, initialFocus);
    if (focusTarget) {
      focusTarget.focus();
    } else {
      layer.focus();
    }

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = getFocusableElements(layer);
      if (focusable.length === 0) {
        event.preventDefault();
        layer.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) {
        event.preventDefault();
        return;
      }
      const active = ownerDocument.activeElement;
      if (event.shiftKey) {
        if (active === first || active === layer || !layer.contains(active)) {
          event.preventDefault();
          last.focus();
        }
        return;
      }
      if (active === last || active === layer || !layer.contains(active)) {
        event.preventDefault();
        first.focus();
      }
    };

    ownerDocument.addEventListener('keydown', onKeyDown, true);
    return () => {
      ownerDocument.removeEventListener('keydown', onKeyDown, true);
      if (!restoreFocus) return;
      const trigger = triggerRef.current;
      if (!trigger || !trigger.isConnected) return;
      trigger.focus();
    };
  }, [initialFocus, layerRef, open, restoreFocus]);
}

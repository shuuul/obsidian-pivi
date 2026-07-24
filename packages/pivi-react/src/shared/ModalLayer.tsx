import { type ReactNode, useRef } from 'react';

import { type ModalInitialFocus, useModalLayer } from './useModalLayer';

export interface ModalLayerProps {
  readonly ariaLabel: string;
  readonly children: ReactNode;
  readonly className?: string;
  readonly initialFocus?: ModalInitialFocus;
  readonly onClose: () => void;
  readonly open: boolean;
  readonly restoreFocus?: boolean;
}

/** Layered modal shell with shared focus trap, Escape, and trigger restoration. */
export function ModalLayer({
  ariaLabel,
  children,
  className,
  initialFocus = 'cancel',
  onClose,
  open,
  restoreFocus = true,
}: ModalLayerProps) {
  const layerRef = useRef<HTMLDivElement>(null);
  useModalLayer({ open, layerRef, onClose, initialFocus, restoreFocus });
  if (!open) return null;
  return (
    <div
      className={className ? `pivi-modal-layer ${className}` : 'pivi-modal-layer'}
      ref={layerRef}
      role="dialog"
      aria-modal="true"
      aria-label={ariaLabel}
    >
      <div
        className="pivi-modal-backdrop"
        onClick={onClose}
      />
      {children}
    </div>
  );
}

import type { EditorView } from '@codemirror/view';

import type { SelectionRect } from './types';

const DEFAULT_VIEWPORT_MARGIN = 8;
const DEFAULT_GAP = 8;

export function getSelectionRect(editorView: EditorView): SelectionRect | null {
  const selection = editorView.state.selection.main;
  if (selection.empty) {
    return null;
  }

  const fromCoords = editorView.coordsAtPos(selection.from);
  const toCoords = editorView.coordsAtPos(selection.to);
  if (!fromCoords || !toCoords) {
    return null;
  }

  return {
    top: Math.min(fromCoords.top, toCoords.top),
    bottom: Math.max(fromCoords.bottom, toCoords.bottom),
    left: Math.min(fromCoords.left, toCoords.left),
    right: Math.max(fromCoords.right, toCoords.right),
  };
}

export function clampOverlayPosition(args: {
  overlayWidth: number;
  overlayHeight: number;
  anchor: SelectionRect;
  viewport: { width: number; height: number };
  gap?: number;
  orientation?: 'above' | 'below';
}): { left: number; top: number } {
  const gap = args.gap ?? DEFAULT_GAP;
  const margin = DEFAULT_VIEWPORT_MARGIN;
  const orientation = args.orientation ?? 'above';
  const { anchor, overlayHeight, overlayWidth, viewport } = args;

  let top: number;
  if (orientation === 'below') {
    top = anchor.bottom + gap;
    if (top + overlayHeight > viewport.height - margin) {
      top = anchor.top - overlayHeight - gap;
      if (top < margin) {
        top = margin;
      }
    }
  } else {
    top = anchor.top - overlayHeight - gap;
    if (top < margin) {
      top = anchor.bottom + gap;
      if (top + overlayHeight > viewport.height - margin) {
        top = viewport.height - overlayHeight - margin;
      }
    }
  }

  const centerX = (anchor.left + anchor.right) / 2;
  const minLeft = margin;
  const maxLeft = viewport.width - overlayWidth - margin;
  const left = Math.max(minLeft, Math.min(centerX - overlayWidth / 2, maxLeft));

  return { left, top };
}

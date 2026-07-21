import { clampOverlayPosition, getSelectionRect } from '@/ui/shared/selectionToolbar/selectionGeometry';
import type { SelectionRect } from '@/ui/shared/selectionToolbar/types';

function createMockEditorView(args: {
  from: number;
  to: number;
  text: string;
  fromCoords?: { top: number; bottom: number; left: number; right: number } | null;
  toCoords?: { top: number; bottom: number; left: number; right: number } | null;
}) {
  const selection = {
    from: args.from,
    to: args.to,
    empty: args.from === args.to,
  };
  return {
    state: {
      selection: { main: selection },
      doc: {
        sliceString: (from: number, to: number) => args.text.slice(from, to),
      },
    },
    coordsAtPos: (pos: number) => {
      if (pos === args.from) {
        return args.fromCoords ?? null;
      }
      if (pos === args.to) {
        return args.toCoords ?? null;
      }
      return null;
    },
  };
}

describe('selectionGeometry', () => {
  describe('getSelectionRect', () => {
    it('returns null for an empty selection', () => {
      const editorView = createMockEditorView({ from: 3, to: 3, text: 'hello' });
      expect(getSelectionRect(editorView as never)).toBeNull();
    });

    it('builds a bounding box from both selection endpoints', () => {
      const editorView = createMockEditorView({
        from: 0,
        to: 5,
        text: 'hello',
        fromCoords: { top: 10, bottom: 20, left: 5, right: 15 },
        toCoords: { top: 12, bottom: 22, left: 40, right: 50 },
      });

      expect(getSelectionRect(editorView as never)).toEqual({
        top: 10,
        bottom: 22,
        left: 5,
        right: 50,
      } satisfies SelectionRect);
    });

    it('returns null when either endpoint lacks coordinates', () => {
      const editorView = createMockEditorView({
        from: 0,
        to: 2,
        text: 'hi',
        fromCoords: { top: 1, bottom: 2, left: 3, right: 4 },
        toCoords: null,
      });

      expect(getSelectionRect(editorView as never)).toBeNull();
    });
  });

  describe('clampOverlayPosition', () => {
    const anchor: SelectionRect = {
      top: 100,
      bottom: 120,
      left: 90,
      right: 110,
    };

    it('prefers placing the overlay above the anchor', () => {
      expect(clampOverlayPosition({
        overlayWidth: 40,
        overlayHeight: 20,
        anchor,
        viewport: { width: 300, height: 300 },
      })).toEqual({ left: 80, top: 72 });
    });

    it('flips below when there is not enough space above', () => {
      expect(clampOverlayPosition({
        overlayWidth: 40,
        overlayHeight: 20,
        anchor: { top: 10, bottom: 20, left: 50, right: 70 },
        viewport: { width: 200, height: 200 },
      })).toEqual({ left: 40, top: 28 });
    });

    it('clamps horizontally within the viewport margin', () => {
      expect(clampOverlayPosition({
        overlayWidth: 80,
        overlayHeight: 20,
        anchor: { top: 100, bottom: 120, left: 10, right: 20 },
        viewport: { width: 120, height: 200 },
      })).toEqual({ left: 8, top: 72 });
    });

    it('supports below-first orientation with upward flip', () => {
      expect(clampOverlayPosition({
        overlayWidth: 40,
        overlayHeight: 30,
        anchor: { top: 170, bottom: 190, left: 100, right: 120 },
        viewport: { width: 240, height: 200 },
        orientation: 'below',
      })).toEqual({ left: 90, top: 132 });
    });
  });
});

import { StateEffect, StateField } from '@codemirror/state';
import type { DecorationSet } from '@codemirror/view';
import { Decoration, EditorView, WidgetType } from '@codemirror/view';

import type { InlineEditSurfaceSessionId } from './types';

export const INLINE_EDIT_SURFACE_ROOT_CLASS = 'pivi-inline-edit-surface';

export class InlineEditSurfaceWidget extends WidgetType {
  constructor(private readonly root: HTMLElement) {
    super();
  }

  eq(other: InlineEditSurfaceWidget): boolean {
    return other.root === this.root;
  }

  toDOM(): HTMLElement {
    return this.root;
  }

  ignoreEvent(): boolean {
    return true;
  }
}

interface InlineEditSurfaceEntry {
  readonly from: number;
  readonly to: number;
  readonly anchorPos: number;
  readonly widget: InlineEditSurfaceWidget;
  readonly order: number;
}

interface InlineEditSurfaceFieldState {
  readonly decorations: DecorationSet;
  readonly entries: ReadonlyMap<InlineEditSurfaceSessionId, InlineEditSurfaceEntry>;
  readonly nextOrder: number;
}

interface ShowInlineEditSurfacePayload {
  readonly sessionId: InlineEditSurfaceSessionId;
  readonly from: number;
  readonly to: number;
  readonly widget: InlineEditSurfaceWidget;
}

const showInlineEditSurface = StateEffect.define<ShowInlineEditSurfacePayload>();
const hideInlineEditSurface = StateEffect.define<InlineEditSurfaceSessionId>();

function buildDecorations(
  entries: ReadonlyMap<InlineEditSurfaceSessionId, InlineEditSurfaceEntry>,
): DecorationSet {
  const ranges = [];
  for (const [sessionId, entry] of [...entries].sort(
    ([, left], [, right]) => left.order - right.order,
  )) {
    ranges.push(Decoration.widget({
      widget: entry.widget,
      block: true,
      side: -1,
      sessionId,
    }).range(entry.anchorPos));
    if (entry.from < entry.to) {
      ranges.push(Decoration.mark({
        class: 'pivi-inline-edit-surface-selection',
        sessionId,
      }).range(entry.from, entry.to));
    }
  }
  return Decoration.set(ranges, true);
}

const inlineEditSurfaceField = StateField.define<InlineEditSurfaceFieldState>({
  create: () => ({
    decorations: Decoration.none,
    entries: new Map(),
    nextOrder: 0,
  }),
  update(state, tr) {
    const entries = new Map<InlineEditSurfaceSessionId, InlineEditSurfaceEntry>();
    for (const [sessionId, entry] of state.entries) {
      entries.set(sessionId, {
        ...entry,
        from: tr.changes.mapPos(entry.from, 1),
        to: tr.changes.mapPos(entry.to, -1),
        anchorPos: tr.changes.mapPos(entry.anchorPos),
      });
    }

    let nextOrder = state.nextOrder;
    for (const effect of tr.effects) {
      if (effect.is(showInlineEditSurface)) {
        const existing = entries.get(effect.value.sessionId);
        const order = existing?.order ?? nextOrder++;
        entries.set(effect.value.sessionId, {
          from: effect.value.from,
          to: effect.value.to,
          anchorPos: resolveInlineEditAnchorPos(tr.state, effect.value.from),
          widget: effect.value.widget,
          order,
        });
      } else if (effect.is(hideInlineEditSurface)) {
        entries.delete(effect.value);
      }
    }

    return {
      entries,
      nextOrder,
      decorations: buildDecorations(entries),
    };
  },
  provide: field => EditorView.decorations.from(field, value => value.decorations),
});

/**
 * Ensures the surface field is present on this view.
 *
 * Prefer registering `inlineEditSurfaceField` through `registerEditorExtension`
 * so Obsidian reconfigures keep it. This fallback reinstalls after a reconfigure
 * that wiped a prior `appendConfig` install — checking the live state field,
 * not a side WeakSet, so a reused EditorView cannot get stuck believing the
 * field is installed when it is gone.
 */
function ensureInlineEditSurfaceField(editorView: EditorView): void {
  if (editorView.state.field(inlineEditSurfaceField, false) !== undefined) {
    return;
  }
  editorView.dispatch({
    effects: StateEffect.appendConfig.of(inlineEditSurfaceField),
  });
}

/** Returns the document offset for the first line of a selection. */
export function resolveInlineEditAnchorPos(
  stateOrView: EditorView['state'] | EditorView,
  from: number,
): number {
  const state = stateOrView instanceof EditorView ? stateOrView.state : stateOrView;
  return state.doc.lineAt(from).from;
}

export function showInlineEditSurfaceDecoration(
  editorView: EditorView,
  sessionId: InlineEditSurfaceSessionId,
  from: number,
  to: number,
  widget: InlineEditSurfaceWidget,
): void {
  ensureInlineEditSurfaceField(editorView);
  editorView.dispatch({
    effects: showInlineEditSurface.of({ sessionId, from, to, widget }),
  });
}

export function hideInlineEditSurfaceDecoration(
  editorView: EditorView,
  sessionId: InlineEditSurfaceSessionId,
): void {
  if (editorView.state.field(inlineEditSurfaceField, false) === undefined) {
    return;
  }
  editorView.dispatch({
    effects: [
      hideInlineEditSurface.of(sessionId),
      editorView.scrollSnapshot(),
    ],
  });
}

export function getInlineEditSurfaceTargetRange(
  editorView: EditorView,
  sessionId: InlineEditSurfaceSessionId,
): { from: number; to: number } | null {
  const entry = editorView.state.field(inlineEditSurfaceField, false)?.entries.get(sessionId);
  return entry ? { from: entry.from, to: entry.to } : null;
}

export function getInlineEditSurfaceAnchorPos(
  editorView: EditorView,
  sessionId: InlineEditSurfaceSessionId,
): number | null {
  return editorView.state.field(inlineEditSurfaceField, false)
    ?.entries.get(sessionId)?.anchorPos ?? null;
}

export function createInlineEditSurfaceRoot(ownerDocument: Document): HTMLElement {
  const doc = ownerDocument as Document & {
    win: { createDiv: (args?: { cls?: string; attr?: Record<string, string> }) => HTMLElement };
  };
  return doc.win.createDiv({
    cls: INLINE_EDIT_SURFACE_ROOT_CLASS,
    attr: { 'data-pivi-inline-edit-surface': 'true' },
  });
}

export {
  hideInlineEditSurface,
  inlineEditSurfaceField,
  showInlineEditSurface,
};

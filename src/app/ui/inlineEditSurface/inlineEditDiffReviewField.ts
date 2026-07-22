import { StateEffect, StateField } from '@codemirror/state';
import type { DecorationSet } from '@codemirror/view';
import { Decoration, EditorView, WidgetType } from '@codemirror/view';

import { resolveInlineEditAnchorPos } from './inlineEditSurfaceField';
import type { InlineEditDiffReviewKind, InlineEditSurfaceSessionId } from './types';

export class InlineEditDiffReviewWidget extends WidgetType {
  constructor(private readonly root: HTMLElement) {
    super();
  }

  eq(other: InlineEditDiffReviewWidget): boolean {
    return other.root === this.root;
  }

  toDOM(): HTMLElement {
    return this.root;
  }

  ignoreEvent(): boolean {
    return true;
  }
}

export interface InlineEditDiffReviewAcceptRange {
  readonly from: number;
  readonly to: number;
}

interface InlineEditDiffReviewEntry {
  readonly from: number;
  readonly to: number;
  readonly anchorPos: number;
  readonly kind: InlineEditDiffReviewKind;
  readonly widget: InlineEditDiffReviewWidget;
  readonly order: number;
}

interface InlineEditDiffReviewFieldState {
  readonly decorations: DecorationSet;
  readonly entries: ReadonlyMap<InlineEditSurfaceSessionId, InlineEditDiffReviewEntry>;
  readonly nextOrder: number;
}

interface ShowInlineEditDiffReviewPayload {
  readonly sessionId: InlineEditSurfaceSessionId;
  readonly from: number;
  readonly to: number;
  readonly kind: InlineEditDiffReviewKind;
  readonly widget: InlineEditDiffReviewWidget;
}

const showInlineEditDiffReview = StateEffect.define<ShowInlineEditDiffReviewPayload>();
const hideInlineEditDiffReview = StateEffect.define<InlineEditSurfaceSessionId>();

function buildDecorations(
  entries: ReadonlyMap<InlineEditSurfaceSessionId, InlineEditDiffReviewEntry>,
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
    if (entry.kind === 'replacement' && entry.from < entry.to) {
      ranges.push(Decoration.replace({ sessionId }).range(entry.from, entry.to));
    }
  }
  return Decoration.set(ranges, true);
}

const inlineEditDiffReviewField = StateField.define<InlineEditDiffReviewFieldState>({
  create: () => ({
    decorations: Decoration.none,
    entries: new Map(),
    nextOrder: 0,
  }),
  update(state, tr) {
    const entries = new Map<InlineEditSurfaceSessionId, InlineEditDiffReviewEntry>();
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
      if (effect.is(showInlineEditDiffReview)) {
        const existing = entries.get(effect.value.sessionId);
        const order = existing?.order ?? nextOrder++;
        entries.set(effect.value.sessionId, {
          from: effect.value.from,
          to: effect.value.to,
          anchorPos: resolveInlineEditAnchorPos(tr.state, effect.value.from),
          kind: effect.value.kind,
          widget: effect.value.widget,
          order,
        });
      } else if (effect.is(hideInlineEditDiffReview)) {
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
 * Ensures the diff-review field is present on this view.
 *
 * Prefer registering `inlineEditDiffReviewField` through `registerEditorExtension`.
 * Fall back to `appendConfig` only when the live state field is missing so a
 * reused EditorView can recover after Obsidian wipes dynamic config.
 */
function ensureInlineEditDiffReviewField(editorView: EditorView): void {
  if (editorView.state.field(inlineEditDiffReviewField, false) !== undefined) {
    return;
  }
  editorView.dispatch({
    effects: StateEffect.appendConfig.of(inlineEditDiffReviewField),
  });
}

export function showInlineEditDiffReviewDecoration(
  editorView: EditorView,
  sessionId: InlineEditSurfaceSessionId,
  params: {
    from: number;
    to: number;
    kind: InlineEditDiffReviewKind;
    widget: InlineEditDiffReviewWidget;
  },
): void {
  ensureInlineEditDiffReviewField(editorView);
  editorView.dispatch({
    effects: showInlineEditDiffReview.of({ sessionId, ...params }),
  });
}

export function hideInlineEditDiffReviewDecoration(
  editorView: EditorView,
  sessionId: InlineEditSurfaceSessionId,
): void {
  if (editorView.state.field(inlineEditDiffReviewField, false) === undefined) {
    return;
  }
  editorView.dispatch({
    effects: hideInlineEditDiffReview.of(sessionId),
  });
}

export function hasInlineEditDiffReviewReplaceDecoration(
  editorView: EditorView,
  sessionId?: InlineEditSurfaceSessionId,
): boolean {
  const entries = editorView.state.field(inlineEditDiffReviewField, false)?.entries;
  return sessionId
    ? entries?.get(sessionId)?.kind === 'replacement'
    : [...(entries?.values() ?? [])].some(entry => entry.kind === 'replacement');
}

export function hasInlineEditDiffReviewDecoration(
  editorView: EditorView,
  sessionId?: InlineEditSurfaceSessionId,
): boolean {
  const entries = editorView.state.field(inlineEditDiffReviewField, false)?.entries;
  return sessionId ? entries?.has(sessionId) ?? false : (entries?.size ?? 0) > 0;
}

export function getInlineEditDiffReviewAcceptRange(
  editorView: EditorView,
  sessionId: InlineEditSurfaceSessionId,
): InlineEditDiffReviewAcceptRange | null {
  const entry = editorView.state.field(inlineEditDiffReviewField, false)?.entries.get(sessionId);
  if (!entry || (entry.kind === 'replacement' && entry.from >= entry.to)) {
    return null;
  }
  return entry.kind === 'replacement'
    ? { from: entry.from, to: entry.to }
    : { from: entry.to, to: entry.to };
}

export {
  hideInlineEditDiffReview,
  inlineEditDiffReviewField,
  showInlineEditDiffReview,
};

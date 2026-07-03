import {
  RangeSetBuilder,
  StateEffect,
  StateField,
  type Text,
} from "@codemirror/state";
import type { DecorationSet } from "@codemirror/view";
import { Decoration, EditorView, WidgetType } from "@codemirror/view";

import {
  type DiffOp,
  DiffWidget,
} from "./inlineEditDiff";

export interface InlineEditInputHost {
  createInputDOM(): HTMLElement;
}

export type InlineEditWidgetHost = InlineEditInputHost & {
  getOwnerDocument(): Document;
  accept(): void;
  reject(): void;
};


export const showInlineEdit = StateEffect.define<{
  inputPos: number;
  selFrom: number;
  selTo: number;
  widget: InlineEditWidgetHost;
  isInbetween?: boolean;
}>();

export const showDiff = StateEffect.define<{
  from: number;
  to: number;
  diffOps: DiffOp[];
  widget: InlineEditWidgetHost;
}>();

export const showInsertion = StateEffect.define<{
  pos: number;
  diffOps: DiffOp[];
  widget: InlineEditWidgetHost;
}>();

export const hideInlineEdit = StateEffect.define<null>();

class InputWidget extends WidgetType {
  constructor(private controller: InlineEditWidgetHost) {
    super();
  }
  toDOM(): HTMLElement {
    return this.controller.createInputDOM();
  }
  eq(): boolean {
    return false;
  }
  ignoreEvent(): boolean {
    return true;
  }
}

const inlineEditField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update: (deco, tr) => {
    deco = deco.map(tr.changes);
    for (const e of tr.effects) {
      if (e.is(showInlineEdit)) {
        // Block above line for selection/inline mode, inline widget for inbetween mode
        deco = buildInlineEditInputDecorations({
          doc: tr.state.doc,
          inputPos: e.value.inputPos,
          isInbetween: e.value.isInbetween,
          widget: new InputWidget(e.value.widget),
        });
      } else if (e.is(showDiff)) {
        const builder = new RangeSetBuilder<Decoration>();
        builder.add(
          e.value.from,
          e.value.to,
          Decoration.replace({
            widget: new DiffWidget(e.value.diffOps, e.value.widget),
          }),
        );
        deco = builder.finish();
      } else if (e.is(showInsertion)) {
        const builder = new RangeSetBuilder<Decoration>();
        builder.add(
          e.value.pos,
          e.value.pos,
          Decoration.widget({
            widget: new DiffWidget(e.value.diffOps, e.value.widget),
            side: 1, // After the position
          }),
        );
        deco = builder.finish();
      } else if (e.is(hideInlineEdit)) {
        deco = Decoration.none;
      }
    }
    return deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});

const installedEditors = new WeakSet<EditorView>();

export function installInlineEditExtension(editorView: EditorView): void {
  if (!installedEditors.has(editorView)) {
    editorView.dispatch({
      effects: StateEffect.appendConfig.of(inlineEditField),
    });
    installedEditors.add(editorView);
  }
}

export function buildInlineEditInputDecorations(options: {
  doc: Text;
  inputPos: number;
  isInbetween?: boolean;
  widget: WidgetType;
}): DecorationSet {
  // Decoration.set(..., true) sorts line and widget decorations by CodeMirror's
  // internal range ordering, including equal-position block widgets at line start.
  const isInbetween = options.isInbetween ?? false;
  const lineStart = options.doc.lineAt(options.inputPos).from;
  return Decoration.set(
    [
      Decoration.line({
        class: "pivi-inline-input-line",
      }).range(lineStart),
      Decoration.widget({
        widget: options.widget,
        block: !isInbetween,
        side: isInbetween ? 1 : -1,
      }).range(options.inputPos),
    ],
    true,
  );
}
import type { EditorView } from '@codemirror/view';

export interface SelectionRect {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export interface EditorSelectionSnapshot {
  from: number;
  to: number;
  text: string;
  rect: SelectionRect;
  editorView: EditorView;
}

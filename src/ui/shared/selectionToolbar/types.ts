import type { EditorView } from '@codemirror/view';
import type { Editor } from 'obsidian';

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
  /** Owning markdown editor when available at snapshot time. */
  editor?: Editor;
}

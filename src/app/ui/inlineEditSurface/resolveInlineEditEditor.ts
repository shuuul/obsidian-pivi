import type { EditorView } from '@codemirror/view';
import type { Editor } from 'obsidian';
import { editorInfoField } from 'obsidian';

/**
 * Resolves the Obsidian editor that owns a CodeMirror view.
 *
 * Args:
 *   editorView: Inline edit surface editor view.
 *
 * Returns:
 *   The owning editor, or null when the view is not bound to a markdown editor.
 */
export function resolveEditorFromEditorView(editorView: EditorView): Editor | null {
  // editorInfoField is unavailable in bare CM6 views (and in Jest mocks); treat the
  // editor as unresolvable instead of letting state.field throw on an undefined field.
  if (!editorInfoField) {
    return null;
  }
  const info = editorView.state.field(editorInfoField, false);
  return info?.editor ?? null;
}

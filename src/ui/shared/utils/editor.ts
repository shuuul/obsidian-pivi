import type { EditorView } from '@codemirror/view';
import type { Editor } from 'obsidian';

import { getEditorCmView } from './obsidianPrivateApi';

/**
 * Gets the CodeMirror EditorView from an Obsidian Editor.
 * Obsidian's Editor type doesn't expose the internal `.cm` property.
 */
export function getEditorView(editor: Editor): EditorView | undefined {
  return getEditorCmView(editor);
}

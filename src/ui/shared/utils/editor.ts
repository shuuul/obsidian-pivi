import type { EditorView } from '@codemirror/view';
import type { Editor } from 'obsidian';

export * from '@pivi/pivi-agent-core/context/editor';

/**
 * Gets the CodeMirror EditorView from an Obsidian Editor.
 * Obsidian's Editor type doesn't expose the internal `.cm` property.
 */
export function getEditorView(editor: Editor): EditorView | undefined {
  return (editor as unknown as { cm?: EditorView }).cm;
}

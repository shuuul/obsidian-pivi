import type { InlineContextPosition, InlineContextReference } from '@pivi/pivi-agent-core/context/inlineContext';
import type { App, Editor, EditorPosition } from 'obsidian';
import { MarkdownView } from 'obsidian';

import { flashSelectionHighlight } from '../components/SelectionHighlight';
import { getEditorView } from '../utils/editor';

function clampEditorPosition(editor: Editor, position: InlineContextPosition): EditorPosition {
  const line = Math.max(0, Math.min(position.line, editor.lastLine()));
  return {
    line,
    ch: Math.max(0, Math.min(position.ch, editor.getLine(line).length)),
  };
}

/** Opens an inline-context source and briefly calls attention to its captured range. */
export async function revealInlineContext(
  app: App,
  context: InlineContextReference,
): Promise<void> {
  await app.workspace.openLinkText(context.notePath, '');

  const view = app.workspace.getActiveViewOfType(MarkdownView);
  if (!view || view.file?.path !== context.notePath) return;

  const from = clampEditorPosition(view.editor, context.selection.from);
  const to = clampEditorPosition(view.editor, context.selection.to);
  view.editor.setSelection(from, to);
  view.editor.scrollIntoView({ from, to }, true);
  view.editor.focus();

  const editorView = getEditorView(view.editor);
  if (!editorView) return;
  flashSelectionHighlight(
    editorView,
    view.editor.posToOffset(from),
    view.editor.posToOffset(to),
  );
}

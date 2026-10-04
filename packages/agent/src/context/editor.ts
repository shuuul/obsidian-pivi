/**
 * Pivi - Editor Context Utilities
 *
 * Editor selection context formatting for prompts.
 */

export interface EditorSelectionContext {
  notePath: string;
  mode: 'selection' | 'none';
  selectedText?: string;
  lineCount?: number; // Number of lines in selection (for UI indicator)
  startLine?: number; // 1-indexed starting line number
}

function formatEditorContext(context: EditorSelectionContext): string {
  if (context.mode === 'selection' && context.selectedText) {
    const lineAttr = context.startLine && context.lineCount
      ? ` lines="${context.startLine}-${context.startLine + context.lineCount - 1}"`
      : '';
    return `<editor_selection path="${context.notePath}"${lineAttr}>\n${context.selectedText}\n</editor_selection>`;
  }
  return '';
}

export function appendEditorContext(prompt: string, context: EditorSelectionContext): string {
  const formatted = formatEditorContext(context);
  return formatted ? `${prompt}\n\n${formatted}` : prompt;
}

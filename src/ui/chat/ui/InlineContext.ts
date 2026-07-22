import {
  buildMarkedSelectionText,
  type InlineContextReference,
  normalizeEditorSelection,
} from '@pivi/pivi-agent-core/context/inlineContext';
import type { Editor, MarkdownView } from 'obsidian';
import { Notice } from 'obsidian';

import { t } from '@/app/i18n';

import type { RichChatInput } from './RichChatInput';

export interface InlineContextCallbacks {
  onContextsChanged?: () => void;
}

export function captureEditorSelectionInlineContext(
  editor: Editor,
  view: MarkdownView,
): InlineContextReference | null {
  if (view.getMode() === 'preview') {
    return null;
  }

  const selectedText = editor.getSelection();
  const notePath = view.file?.path;
  if (!selectedText.trim() || !notePath) {
    return null;
  }

  const normalized = normalizeEditorSelection(
    editor.getCursor('from'),
    editor.getCursor('to'),
  );
  const noteName = view.file?.name ?? notePath.split('/').pop() ?? notePath;

  return {
    type: 'editor-selection',
    notePath,
    noteName,
    selection: {
      from: normalized.from,
      to: normalized.to,
    },
    includedLines: {
      from: normalized.includedLineFrom + 1,
      to: normalized.includedLineTo + 1,
    },
    text: buildMarkedSelectionText(
      line => editor.getLine(line),
      normalized.from,
      normalized.to,
    ),
  };
}

export class InlineContextManager {
  private callbacks: InlineContextCallbacks;
  private inputEl: RichChatInput;

  constructor(
    inputEl: RichChatInput,
    callbacks: InlineContextCallbacks,
  ) {
    this.inputEl = inputEl;
    this.callbacks = callbacks;
  }

  addSelectionFromEditor(editor: Editor, view: MarkdownView): boolean {
    const snapshot = captureEditorSelectionInlineContext(editor, view);
    if (!snapshot) {
      new Notice(t('chat.inlineContext.selectTextFirst'), 3000);
      return false;
    }

    this.inputEl.insertInlineContext(snapshot);
    this.callbacks.onContextsChanged?.();
    return true;
  }

  clearAfterSend(): void {
    // Inline context badges live in the composer text and are cleared with the input.
  }

  resetForNewSession(): void {
    this.clearAfterSend();
  }

  resetForLoadedSession(_hasMessages?: boolean): void {
    this.clearAfterSend();
  }

  destroy(): void {
    // No external resources owned.
  }

}

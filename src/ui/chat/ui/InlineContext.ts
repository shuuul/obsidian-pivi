import {
  buildMarkedSelectionText,
  type InlineContextReference,
  normalizeEditorSelection,
} from '@pivi/pivi-agent-core/context/inlineContext';
import type { Editor, MarkdownView } from 'obsidian';
import { Notice } from 'obsidian';

import { t } from '@/i18n';

import type { RichChatInput } from './RichChatInput';

export interface InlineContextCallbacks {
  onContextsChanged?: () => void;
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
    const snapshot = this.captureEditorSelection(editor, view);
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

  private captureEditorSelection(editor: Editor, view: MarkdownView): InlineContextReference | null {
    if (view.getMode() === 'preview') {
      return null;
    }

    const selectedText = editor.getSelection();
    if (!selectedText.trim()) {
      return null;
    }

    const notePath = view.file?.path;
    if (!notePath) {
      return null;
    }

    const fromPos = editor.getCursor('from');
    const toPos = editor.getCursor('to');
    const normalized = normalizeEditorSelection(fromPos, toPos);
    const markedText = buildMarkedSelectionText(
      (line) => editor.getLine(line),
      normalized.from,
      normalized.to,
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
      text: markedText,
    };
  }
}

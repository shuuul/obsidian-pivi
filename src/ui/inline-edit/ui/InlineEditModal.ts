import type { EditorView } from '@codemirror/view';
import {
  hideInlineEditWidget,
  type InlineEditContext,
  type InlineEditDecision,
  installInlineEditWidgetExtension,
  showInlineEditWidget,
} from '@pivi/obsidian-ui';
import type { Editor } from 'obsidian';
import { type MarkdownView,Notice } from 'obsidian';

import type { PiviChatHost } from '@/app/hostContracts';
import { appI18n } from '@/app/i18n';
import { createInlineEditPort } from '@/app/ui/createInlineEditPort';
import { hideSelectionHighlight, showSelectionHighlight } from '@/ui/shared/components/SelectionHighlight';
import { getEditorView } from '@/ui/shared/utils/editor';

export type { InlineEditContext, InlineEditDecision };

let activeInlineEditModal: InlineEditModal | null = null;
function setActiveInlineEditModal(modal: InlineEditModal | null): void {
  activeInlineEditModal = modal;
}


export class InlineEditModal {
  private editorView: EditorView | null = null;
  private positions: { from: number; to: number } | null = null;
  private resolveResult: ((result: { decision: InlineEditDecision; editedText?: string }) => void) | null = null;
  private disposed = false;

  constructor(
    private readonly plugin: PiviChatHost,
    private readonly editor: Editor,
    private readonly view: MarkdownView,
    private readonly editContext: InlineEditContext,
    private readonly notePath: string,
    private readonly getExternalContexts: () => string[] = () => [],
  ) {}

  openAndWait(): Promise<{ decision: InlineEditDecision; editedText?: string }> {
    activeInlineEditModal?.reject();
    const editorView = getEditorView(this.editor);
    if (!editorView) {
      new Notice(appI18n.t('inlineEdit.unavailableEditor'));
      return Promise.resolve({ decision: 'reject' });
    }
    this.editorView = editorView;
    this.positions = this.getPositions(editorView);
    if (!this.positions) return Promise.resolve({ decision: 'reject' });
    setActiveInlineEditModal(this);
    this.editorView.dom.classList.add('pivi-inline-edit-modal');
    if (this.editContext.mode === 'selection' && this.positions.from !== this.positions.to) {
      showSelectionHighlight(this.editorView, this.positions.from, this.positions.to);
    }
    this.view.register(() => this.reject());
    installInlineEditWidgetExtension(this.editorView);
    const { promise, resolve } = (Promise as typeof Promise & {
      withResolvers<T>(): { promise: Promise<T>; resolve: (value: T) => void };
    }).withResolvers<{ decision: InlineEditDecision; editedText?: string }>();
    this.resolveResult = resolve;
    const isInbetween = this.editContext.mode === 'cursor' && this.editContext.cursorContext.isInbetween;
    this.editorView.dispatch({
      effects: showInlineEditWidget.of({
        pos: isInbetween ? this.positions.from : this.editorView.state.doc.lineAt(this.positions.from).from,
        block: !isInbetween,
        options: {
          container: this.editorView.dom,
          ownerDocument: this.editorView.dom.ownerDocument,
          ownerWindow: this.editorView.dom.ownerDocument.defaultView ?? window,
          modelOverride: this.plugin.getView()?.getActiveTab()?.service?.getAuxiliaryModel?.()
            ?? this.plugin.getView()?.getActiveTab()?.draftModel
            ?? null,
          i18n: appI18n,
          port: createInlineEditPort(this.plugin),
          context: this.editContext,
          notePath: this.notePath,
          contextFiles: this.getExternalContexts,
          onStateChange: (state) => {
            if (state.phase === 'diff') hideSelectionHighlight(this.editorView!);
          },
          accept: (text) => this.accept(text),
          reject: () => this.reject(),
        },
      }),
    });
    return promise;
  }

  reject(): void {
    if (this.disposed) return;
    const positions = this.positions;
    this.cleanup();
    if (this.editContext.mode === 'selection' && positions && positions.from !== positions.to && this.editorView) {
      showSelectionHighlight(this.editorView, positions.from, positions.to);
    }
    this.resolveResult?.({ decision: 'reject' });
    this.resolveResult = null;
  }

  private accept(text: string): void {
    const positions = this.positions;
    const editorView = this.editorView;
    if (!positions || !editorView || this.disposed) {
      this.reject();
      return;
    }
    const fromLine = editorView.state.doc.lineAt(positions.from);
    const toLine = editorView.state.doc.lineAt(positions.to);
    this.cleanup();
    this.editor.replaceRange(text, { line: fromLine.number - 1, ch: positions.from - fromLine.from }, { line: toLine.number - 1, ch: positions.to - toLine.from });
    this.resolveResult?.({ decision: 'accept', editedText: text });
    this.resolveResult = null;
  }

  private getPositions(editorView: EditorView): { from: number; to: number } {
    if (this.editContext.mode === 'cursor') {
      const context = this.editContext.cursorContext;
      const line = editorView.state.doc.line(context.line + 1);
      const position = line.from + context.column;
      return { from: position, to: position };
    }
    const from = this.editor.getCursor('from');
    const to = this.editor.getCursor('to');
    const fromLine = editorView.state.doc.line(from.line + 1);
    const toLine = editorView.state.doc.line(to.line + 1);
    return { from: fromLine.from + from.ch, to: toLine.from + to.ch };
  }

  private cleanup(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (activeInlineEditModal === this) setActiveInlineEditModal(null);
    if (this.editorView) {
      this.editorView.dom.classList.remove('pivi-inline-edit-modal');
      this.editorView.dispatch({ effects: hideInlineEditWidget.of(null) });
      hideSelectionHighlight(this.editorView);
    }
  }
}

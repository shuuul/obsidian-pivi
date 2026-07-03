import type { App, Editor, MarkdownView } from "obsidian";
import { Notice } from "obsidian";

import type PiviPlugin from "@/app/PiviPluginHost";

import { getEditorView } from "../../shared/utils/editor";
import { buildInlineEditInputDecorations } from "./inlineEditCodeMirror";
import {
  getActiveInlineEditController,
  InlineEditController,
  setActiveInlineEditController,
} from "./inlineEditController";
import type { InlineEditContext, InlineEditDecision } from "./inlineEditTypes";

export type { InlineEditContext, InlineEditDecision };
export { buildInlineEditInputDecorations };

export class InlineEditModal {
  private controller: InlineEditController | null = null;

  constructor(
    private app: App,
    private plugin: PiviPlugin,
    private editor: Editor,
    private view: MarkdownView,
    private editContext: InlineEditContext,
    private notePath: string,
    private getExternalContexts: () => string[] = () => [],
  ) {}

  async openAndWait(): Promise<{
    decision: InlineEditDecision;
    editedText?: string;
  }> {
    const existing = getActiveInlineEditController();
    if (existing) {
      existing.reject();
      return { decision: "reject" };
    }

    // Use the editor/view provided by Obsidian's editorCallback.
    // This avoids timing issues during leaf/view transitions (e.g., navigating via Search in the same tab).
    let editor = this.editor;
    let editorView = getEditorView(editor);

    // Fallback: in rare cases Obsidian may re-initialize the editor between callback and modal open.
    if (!editorView) {
      editor = this.view.editor;
      editorView = getEditorView(editor);
    }

    if (!editorView) {
      new Notice(
        "Inline edit unavailable: could not access the active editor. Try reopening the note.",
      );
      return { decision: "reject" };
    }

    return new Promise((resolve) => {
      this.controller = new InlineEditController(
        this.app,
        this.plugin,
        editorView,
        editor,
        this.editContext,
        this.notePath,
        this.getExternalContexts,
        resolve,
      );
      setActiveInlineEditController(this.controller);
      this.controller.show();
    });
  }
}
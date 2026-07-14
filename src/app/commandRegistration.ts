import { buildCursorContext } from "@pivi/pivi-agent-core/context/editor";
import type { Editor } from "obsidian";
import { MarkdownView, Notice } from "obsidian";

import { t } from "@/app/i18n";
import { createInlineEditPort } from "@/app/ui/createInlineEditPort";
import type PiviPlugin from "@/main"
import {
  type InlineEditContext,
  InlineEditModal,
} from "@/ui/inline-edit/ui/InlineEditModal";

import { findPiviView } from "./viewAccess";

export const ADD_SELECTION_TO_CHAT_INPUT_COMMAND_ID =
  "add-selection-to-chat-input";

export function registerPiviCommands(plugin: PiviPlugin): void {
  plugin.addCommand({
    id: "open-view",
    name: t("commands.openChatView"),
    callback: () => {
      void plugin.activateView();
    },
  });

  plugin.addCommand({
    id: "inline-edit",
    name: t("commands.inlineEdit"),
    editorCallback: async (editor: Editor, ctx) => {
      const view =
        ctx instanceof MarkdownView
          ? ctx
          : plugin.app.workspace.getActiveViewOfType(MarkdownView);
      if (!view) {
        new Notice(t("commands.inlineEditUnavailableView"));
        return;
      }

      await plugin.ensureWorkspaceServices();

      const selectedText = editor.getSelection();
      const notePath = view.file?.path || "unknown";

      let editContext: InlineEditContext;
      if (selectedText.trim()) {
        editContext = { mode: "selection", selectedText };
      } else {
        const cursor = editor.getCursor();
        const cursorContext = buildCursorContext(
          (line) => editor.getLine(line),
          editor.lineCount(),
          cursor.line,
          cursor.ch,
        );
        editContext = { mode: "cursor", cursorContext };
      }

      const modal = new InlineEditModal(
        editor,
        view,
        editContext,
        notePath,
        findPiviView(plugin.app)?.getChatHandle()?.commands.getInlineEditModel() ?? null,
        () =>
          findPiviView(plugin.app)
            ?.getChatHandle()
            ?.commands.getActiveExternalContexts() ?? [],
        createInlineEditPort(plugin),
      );
      const result = await modal.openAndWait();

      if (result.decision === "accept" && result.editedText !== undefined) {
        new Notice(
          editContext.mode === "cursor"
            ? t("commands.inlineEditInserted")
            : t("commands.inlineEditApplied"),
        );
      }
    },
  });

  plugin.addCommand({
    id: ADD_SELECTION_TO_CHAT_INPUT_COMMAND_ID,
    name: t("chat.inlineContext.addSelectionToChatInput"),
    editorCallback: (editor: Editor, ctx) => {
      const view =
        ctx instanceof MarkdownView
          ? ctx
          : plugin.app.workspace.getActiveViewOfType(MarkdownView);
      if (!view || view.getMode() === "preview") {
        new Notice(t("chat.inlineContext.selectTextFirst"));
        return;
      }

      void plugin.addEditorSelectionToChatInput(editor, view);
    },
  });

  plugin.registerEvent(
    plugin.app.workspace.on("editor-menu", (menu, editor, info) => {
      if (!editor.somethingSelected()) {
        return;
      }

      const view = plugin.app.workspace.getActiveViewOfType(MarkdownView);
      if (
        !view ||
        view.file?.path !== info.file?.path ||
        view.getMode() === "preview"
      ) {
        return;
      }

      menu.addItem((item) => {
        item
          .setTitle(t("chat.inlineContext.addSelectionToChatInput"))
          .setIcon("text-select")
          .onClick(() => {
            void plugin.addEditorSelectionToChatInput(editor, view);
          });
      });
    }),
  );

  plugin.addCommand({
    id: "new-tab",
    name: t("commands.newTab"),
    checkCallback: (checking: boolean) => {
      if (!plugin.canCreateNewTab()) return false;

      if (!checking) {
        void plugin.openNewTab();
      }
      return true;
    },
  });

  plugin.addCommand({
    id: "new-session",
    name: t("commands.newSession"),
    checkCallback: (checking: boolean) => {
      const view = findPiviView(plugin.app);
      if (!view) return false;

      const commands = view.getChatHandle()?.commands;
      if (!commands?.getState().canStartNewSession) return false;

      if (!checking) {
        void commands.startNewSession();
      }
      return true;
    },
  });

  plugin.addCommand({
    id: "close-current-tab",
    name: t("commands.closeCurrentTab"),
    checkCallback: (checking: boolean) => {
      const view = findPiviView(plugin.app);
      if (!view) return false;

      const commands = view.getChatHandle()?.commands;
      if (!commands?.getState().canCloseActiveTab) return false;

      if (!checking) {
        void commands.closeActiveTab();
      }
      return true;
    },
  });
}

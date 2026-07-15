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
import { getActiveWindow } from "@/ui/shared/dom";

import { findPiviView } from "./viewAccess";

export const ADD_SELECTION_TO_CHAT_INPUT_COMMAND_ID =
  "add-selection-to-chat-input";
const CHAT_PERF_SCENARIO_PATH = '.pivi/perf-scenario.txt';

export function registerPiviCommands(plugin: PiviPlugin): void {
  if (process.env.NODE_ENV !== 'production') registerChatPerfCommands(plugin);
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

function registerChatPerfCommands(plugin: PiviPlugin): void {
  plugin.addCommand({
    id: 'debug-start-chat-performance-trace',
    name: 'Debug: start chat performance trace',
    callback: () => {
      const ownerWindow = getActiveWindow();
      void resolveChatPerfScenario(plugin).then((scenario) => {
        plugin.getChatPerfController().start(scenario, ownerWindow);
        new Notice(`Chat performance trace started: ${scenario}`);
      }).catch((error: unknown) => {
        new Notice(error instanceof Error ? error.message : String(error));
      });
    },
  });

  plugin.addCommand({
    id: 'debug-sample-chat-performance-heap',
    name: 'Debug: sample chat performance heap',
    callback: () => {
      try {
        plugin.getChatPerfController().sampleHeap('manual', getActiveWindow());
        new Notice('Chat performance heap sample recorded.');
      } catch (error) {
        new Notice(error instanceof Error ? error.message : String(error));
      }
    },
  });

  plugin.addCommand({
    id: 'debug-run-100kb-markdown-stream',
    name: 'Debug: run large Markdown performance stream',
    callback: () => {
      const controller = plugin.getChatPerfController();
      const development = findPiviView(plugin.app)?.getChatHandle()?.development;
      if (!controller.enabled) {
        new Notice('Start a chat performance trace before running the Markdown stream.');
        return;
      }
      if (!development) {
        new Notice('A mounted Pivi chat view is required.');
        return;
      }
      void development.run100KbMarkdownStream().then(({ bytes, chunks }) => {
        new Notice(`Streamed ${bytes} Markdown bytes in ${chunks} chunks.`);
      }).catch((error: unknown) => {
        new Notice(error instanceof Error ? error.message : String(error));
      });
    },
  });

  plugin.addCommand({
    id: 'debug-run-tab-switching-workload',
    name: 'Debug: run isolated tab switching workload',
    callback: () => {
      const controller = plugin.getChatPerfController();
      const development = findPiviView(plugin.app)?.getChatHandle()?.development;
      if (!controller.enabled) {
        new Notice('Start a chat performance trace before running the tab switching workload.');
        return;
      }
      if (!development) {
        new Notice('A mounted Pivi chat view is required.');
        return;
      }
      void development.runTabSwitchingWorkload().then(({ switches, tabs }) => {
        new Notice(`Switched ${switches} times across ${tabs} isolated tabs.`);
      }).catch((error: unknown) => {
        new Notice(error instanceof Error ? error.message : String(error));
      });
    },
  });

  plugin.addCommand({
    id: 'debug-stop-chat-performance-trace',
    name: 'Debug: stop and export chat performance trace',
    callback: () => {
      void plugin.getChatPerfController().stopAndExport(getActiveWindow()).then((path) => {
        new Notice(`Chat performance trace exported to ${path}`);
      }).catch((error: unknown) => {
        new Notice(error instanceof Error ? error.message : String(error));
      });
    },
  });
}

async function resolveChatPerfScenario(plugin: PiviPlugin): Promise<string> {
  const adapter = plugin.app.vault.adapter;
  if (!(await adapter.exists(CHAT_PERF_SCENARIO_PATH))) return 'manual';
  const scenario = (await adapter.read(CHAT_PERF_SCENARIO_PATH)).trim();
  if (!scenario) throw new Error(`${CHAT_PERF_SCENARIO_PATH} is empty.`);
  return scenario;
}

import type { Editor, Plugin } from "obsidian";
import { MarkdownView, Notice } from "obsidian";

import type { ChatFacade } from "@/app/hostContracts";
import { t } from "@/app/i18n";
import { openInlineEditForEditorSelection } from "@/app/ui/selectionToolbar/SelectionToolbarSurfaceController";
import { getActiveWindow } from "@/ui/shared/dom";

import { findPiviView } from "./viewAccess";

export const ADD_SELECTION_TO_CHAT_INPUT_COMMAND_ID =
  "add-selection-to-chat-input";
export const INLINE_EDIT_SELECTION_COMMAND_ID = "inline-edit-selection";
const CHAT_PERF_SCENARIO_PATH = '.pivi/perf-scenario.txt';

export function registerPiviCommands(plugin: Plugin, chat: ChatFacade): void {
  if (process.env.NODE_ENV !== 'production') registerChatPerfCommands(plugin, chat);
  plugin.addCommand({
    id: "open-view",
    name: t("commands.openChatView"),
    callback: () => {
      void chat.activateView();
    },
  });

  plugin.addCommand({
    id: INLINE_EDIT_SELECTION_COMMAND_ID,
    name: t("settings.inlineEditSelectionHotkey.name"),
    editorCheckCallback: (checking: boolean, editor: Editor, ctx) => {
      const view =
        ctx instanceof MarkdownView
          ? ctx
          : plugin.app.workspace.getActiveViewOfType(MarkdownView);
      if (!view || view.getMode() === "preview" || !editor.somethingSelected()) {
        return false;
      }
      if (!checking && !openInlineEditForEditorSelection(editor)) {
        new Notice(t("chat.inlineContext.selectTextFirst"));
      }
      return true;
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

      void chat.addEditorSelectionToChatInput(editor, view);
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
            void chat.addEditorSelectionToChatInput(editor, view);
          });
      });
    }),
  );

  plugin.addCommand({
    id: "new-tab",
    name: t("commands.newTab"),
    checkCallback: (checking: boolean) => {
      if (!chat.canCreateNewTab()) return false;

      if (!checking) {
        void chat.openNewTab();
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

function registerChatPerfCommands(plugin: Plugin, chat: ChatFacade): void {
  plugin.addCommand({
    id: 'debug-start-chat-performance-trace',
    name: 'Debug: start chat performance trace',
    callback: () => {
      const ownerWindow = getActiveWindow();
      void resolveChatPerfScenario(chat).then((scenario) => {
        chat.getChatPerfController().start(scenario, ownerWindow);
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
        chat.getChatPerfController().sampleHeap('manual', getActiveWindow());
        new Notice('Chat performance heap sample recorded.');
      } catch (error) {
        new Notice(error instanceof Error ? error.message : String(error));
      }
    },
  });

  plugin.addCommand({
    id: 'debug-run-projection-workload-suite',
    name: 'Debug: run projection performance workload suite',
    callback: () => {
      const controller = chat.getChatPerfController();
      const development = findPiviView(chat.app)?.getChatHandle()?.development;
      const runProjectionWorkload = development?.runProjectionWorkload?.bind(development);
      if (controller.enabled) {
        new Notice('Stop the active chat performance trace before running projection workloads.');
        return;
      }
      if (!runProjectionWorkload) {
        new Notice('A mounted Pivi chat view is required.');
        return;
      }

      const paths: string[] = [];
      const workloads = ['small-text', 'tool-heavy', 'nested-subagent'] as const;
      void (async () => {
        for (const workload of workloads) {
          await runProjectionWorkload(workload, {
            beforeMeasurement(result) {
              controller.start(
                `projection-${result.workload}-${result.sampleEvents}-events-main`,
                getActiveWindow(),
                result,
              );
              return Promise.resolve();
            },
            async afterMeasurement() {
              paths.push(await controller.stopAndExport(getActiveWindow()));
            },
          });
        }
        new Notice(`Projection workload traces exported: ${paths.join(', ')}`);
      })().catch((error: unknown) => {
        controller.dispose();
        new Notice(error instanceof Error ? error.message : String(error));
      });
    },
  });

  plugin.addCommand({
    id: 'debug-run-20-subagents-workload',
    name: 'Debug: run isolated 20-subagent workload',
    callback: () => {
      const controller = chat.getChatPerfController();
      const development = findPiviView(chat.app)?.getChatHandle()?.development;
      const ownerWindow = getActiveWindow();
      if (controller.enabled) {
        new Notice('Stop the active chat performance trace before running 20 subagents.');
        return;
      }
      if (!development) {
        new Notice('A mounted Pivi chat view is required.');
        return;
      }

      controller.start('subagents-20-main-isolated', ownerWindow);
      let tracePath = '';
      void development.run20SubagentsWorkload({
        async afterRender() {
          tracePath = await controller.stopAndExport(ownerWindow);
        },
      }).then(({ subagents, messages }) => {
        const path = tracePath;
        new Notice(`20-subagent trace exported (${subagents} subagents / ${messages} messages): ${path}`);
      }).catch((error: unknown) => {
        controller.dispose();
        new Notice(error instanceof Error ? error.message : String(error));
      });
    },
  });

  plugin.addCommand({
    id: 'debug-run-indexed-session-paging-workload',
    name: 'Debug: run isolated indexed session paging workload',
    callback: () => {
      const controller = chat.getChatPerfController();
      const development = findPiviView(chat.app)?.getChatHandle()?.development;
      const ownerWindow = getActiveWindow();
      if (controller.enabled) {
        new Notice('Stop the active chat performance trace before running indexed paging.');
        return;
      }
      if (!development) {
        new Notice('A mounted Pivi chat view is required.');
        return;
      }

      const paths: string[] = [];
      controller.start('indexed-cold-open-5k-main-isolated', ownerWindow);
      void development.runIndexedSessionPagingWorkload({
        async afterColdOpen() {
          paths.push(await controller.stopAndExport(ownerWindow));
          controller.start('indexed-older-page-5k-main-isolated', ownerWindow);
        },
        async afterOlderPage() {
          paths.push(await controller.stopAndExport(ownerWindow));
        },
      }).then(({ initialMessages, messagesAfterPrepend }) => {
        new Notice(
          `Indexed paging traces exported (${initialMessages} -> ${messagesAfterPrepend} messages): ${paths.join(', ')}`,
        );
      }).catch((error: unknown) => {
        controller.dispose();
        new Notice(error instanceof Error ? error.message : String(error));
      });
    },
  });

  plugin.addCommand({
    id: 'debug-run-100kb-markdown-stream',
    name: 'Debug: run large Markdown performance stream',
    callback: () => {
      const controller = chat.getChatPerfController();
      const development = findPiviView(chat.app)?.getChatHandle()?.development;
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
      const controller = chat.getChatPerfController();
      const development = findPiviView(chat.app)?.getChatHandle()?.development;
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
      void chat.getChatPerfController().stopAndExport(getActiveWindow()).then((path) => {
        new Notice(`Chat performance trace exported to ${path}`);
      }).catch((error: unknown) => {
        new Notice(error instanceof Error ? error.message : String(error));
      });
    },
  });
}

async function resolveChatPerfScenario(chat: ChatFacade): Promise<string> {
  const adapter = chat.app.vault.adapter;
  if (!(await adapter.exists(CHAT_PERF_SCENARIO_PATH))) return 'manual';
  const scenario = (await adapter.read(CHAT_PERF_SCENARIO_PATH)).trim();
  if (!scenario) throw new Error(`${CHAT_PERF_SCENARIO_PATH} is empty.`);
  return scenario;
}

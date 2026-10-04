import { VIEW_TYPE_PIVI } from "@pivi/agent/runtime";
import type { ChatSessionPort } from "@pivi/agent/runtime/chatPorts";
import type { Plugin } from "obsidian";
import { addIcon, removeIcon } from "obsidian";

import type { PiviChatCompositionHost } from "@/app/hostContracts";
import { t } from "@/app/i18n";
import { runAppAction } from "@/app/runAppAction";
import { PiviViewHost } from "@/app/ui/PiviViewHost";

import piviIconSvg from "../../assets/icons/pivi-p.svg";

export function registerPiviViews(
  plugin: Plugin,
  chat: PiviChatCompositionHost,
  sessions: ChatSessionPort,
): void {
  removeIcon("pivi-p");
  addIcon("pivi-p", piviIconSvg);

  plugin.registerView(
    VIEW_TYPE_PIVI,
    (leaf) => new PiviViewHost(leaf, chat, sessions, () => chat.ensureWorkspaceServices()),
  );

  plugin.addRibbonIcon("pivi-p", t("commands.openPiviRibbon"), () => {
    runAppAction(
      () => chat.activateView(),
      "editor.selectionToolbar.commandUnavailable",
      "Failed to open Pivi from the ribbon",
    );
  });
}

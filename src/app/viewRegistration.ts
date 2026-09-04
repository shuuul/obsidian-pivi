import { VIEW_TYPE_PIVI } from "@pivi/agent/runtime";
import type { Plugin } from "obsidian";
import { addIcon, removeIcon } from "obsidian";

import type { ChatFacade, SessionsFacade, WorkspaceFacade } from "@/app/hostContracts";
import { t } from "@/app/i18n";
import { PiviViewHost } from "@/app/ui/PiviViewHost";

import piviIconSvg from "../../assets/icons/pivi-p.svg";

export function registerPiviViews(
  plugin: Plugin,
  chat: ChatFacade,
  sessions: SessionsFacade,
  workspace: WorkspaceFacade,
): void {
  removeIcon("pivi-p");
  addIcon("pivi-p", piviIconSvg);

  plugin.registerView(
    VIEW_TYPE_PIVI,
    (leaf) => new PiviViewHost(leaf, chat, sessions, () => workspace.ensureWorkspaceServices()),
  );

  plugin.addRibbonIcon("pivi-p", t("commands.openPiviRibbon"), () => {
    void chat.activateView();
  });
}

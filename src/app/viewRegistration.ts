import { VIEW_TYPE_PIVI } from "@pivi/pivi-agent-core/foundation";
import { addIcon, removeIcon } from "obsidian";

import { t } from "@/app/i18n";
import { PiviViewHost } from "@/app/ui/PiviViewHost";
import type PiviPlugin from "@/main"

import piviIconSvg from "../../assets/icons/pivi-p.svg";

export function registerPiviViews(plugin: PiviPlugin): void {
  removeIcon("pivi-p");
  addIcon("pivi-p", piviIconSvg);

  plugin.registerView(
    VIEW_TYPE_PIVI,
    (leaf) => new PiviViewHost(leaf, plugin, () => plugin.ensureWorkspaceServices()),
  );

  plugin.addRibbonIcon("pivi-p", t("commands.openPiviRibbon"), () => {
    void plugin.activateView();
  });
}

import { VIEW_TYPE_PIVI } from "@pivi/pivi-agent-core/foundation";
import type { Plugin } from 'obsidian';
import { addIcon, removeIcon } from "obsidian";

import type { PiviPluginHost } from '@/app/hostContracts';
import { t } from "@/app/i18n";
import { type ChatUiCompositionHost, createChatUiPorts } from '@/app/ui/createUiPorts';
import { PiviViewHost } from "@/app/ui/PiviViewHost";

import piviIconSvg from "../../assets/icons/pivi-p.svg";

export function registerPiviViews(
  owner: Plugin,
  host: PiviPluginHost & ChatUiCompositionHost,
): void {
  removeIcon("pivi-p");
  addIcon("pivi-p", piviIconSvg);

  owner.registerView(
    VIEW_TYPE_PIVI,
    (leaf) => new PiviViewHost(
      leaf,
      host,
      async () => createChatUiPorts(host, await host.ensureWorkspaceServices()),
      host.getUiFacades().chatUIConfig.getChatIcon?.() ?? null,
    ),
  );

  owner.addRibbonIcon("pivi-p", t("commands.openPiviRibbon"), () => {
    void host.activateView();
  });
}

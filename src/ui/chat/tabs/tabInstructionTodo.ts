import type { PiviChatHost } from "@/app/hostContracts";

import { StatusPanel } from "../ui/StatusPanel";
import { ensureTitleGenerationService } from "./tabAgentContext";
import type { TabData } from "./types";

/**
 * Initializes instruction mode and todo panel for a tab.
 */
export function initializeInstructionAndTodo(
  tab: TabData,
  plugin: PiviChatHost,
): void {
  const { dom } = tab;

  ensureTitleGenerationService(tab, plugin);

  tab.ui.statusPanel = new StatusPanel();
  tab.ui.statusPanel.mount(dom.statusPanelContainerEl);
}
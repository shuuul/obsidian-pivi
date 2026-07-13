import type { PiviChatHost } from "@/app/hostContracts";

import { ensureTitleGenerationService } from "./tabAgentContext";
import type { TabData } from "./types";

/** Initializes title generation for a tab. */
export function initializeTitleGeneration(
  tab: TabData,
  plugin: PiviChatHost,
): void {
  ensureTitleGenerationService(tab, plugin);
}
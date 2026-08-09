import type { ChatPorts } from '@pivi/agent/runtime/chatPorts';

import { ensureTitleGenerationService } from "./tabAgentContext";
import type { TabData } from "./types";

/** Initializes title generation for a tab. */
export function initializeTitleGeneration(
  tab: TabData,
  ports: ChatPorts,
): void {
  ensureTitleGenerationService(tab, ports);
}

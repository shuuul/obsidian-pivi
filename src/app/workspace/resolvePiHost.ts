import type { AgentHostContext } from "@pivi/obsidian-host/bootstrap/hostContext";

import type PiviPlugin from "@/main";

export function resolvePiPlugin(host: AgentHostContext): PiviPlugin {
  return host.rawHost as PiviPlugin;
}

import type { SessionStore } from "@pivi/pivi-agent-core/session";

import type { SharedAppStorage } from "./storage";

/** Host-neutral context passed from app composition into Pi-owned services. */
export interface AgentHostContext {
  settings: Record<string, unknown>;
  storage: SharedAppStorage;
  vaultPath: string | null;
  sessionStore?: SessionStore | null;
}

import type { SessionStore } from "../session/types";
import type { SharedAppStorage } from "./storage";

/**
 * Host context passed from the Obsidian composition root into Pi-owned services.
 * Core code treats this as an opaque capability bag; Pi product modules may
 * unwrap `rawHost` when they need plugin APIs.
 */
export interface AgentHostContext {
  settings: Record<string, unknown>;
  storage: SharedAppStorage;
  vaultPath: string | null;
  sessionStore?: SessionStore | null;
  rawHost?: unknown;
}

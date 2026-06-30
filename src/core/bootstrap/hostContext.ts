import type { SessionStore } from "../session/types";
import type { SharedAppStorage } from "./storage";

/**
 * Runtime-neutral host context passed from the Obsidian composition root to an
 * agent adaptor. Core code treats this as an opaque capability bag; concrete
 * adaptors may unwrap `rawHost` in their own layer when they need host-specific
 * APIs during migration.
 */
export interface AgentHostContext {
  settings: Record<string, unknown>;
  storage: SharedAppStorage;
  vaultPath: string | null;
  sessionStore?: SessionStore | null;
  rawHost?: unknown;
}

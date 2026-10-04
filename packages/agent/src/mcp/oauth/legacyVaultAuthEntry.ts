import { createHash } from "crypto";

import type { FileStore } from "../../ports";
import { PIVI_MCP_OAUTH_DIR } from "../paths";
import type { AuthEntry } from "./mcpAuthEntryStore";

/** Where earlier versions kept a server's OAuth entry in plaintext inside the vault. */
export function legacyVaultAuthEntryPath(serverName: string): string {
  const storageKey = createHash("sha256")
    .update(serverName, "utf8")
    .digest("hex");
  return `${PIVI_MCP_OAUTH_DIR}/sha256-${storageKey}/tokens.json`;
}

/** Reads a pre-SecretStorage OAuth entry; migration is the only consumer. */
export async function readLegacyVaultAuthEntry(
  adapter: FileStore,
  serverName: string,
): Promise<AuthEntry | undefined> {
  const path = legacyVaultAuthEntryPath(serverName);
  if (!(await adapter.exists(path))) {
    return undefined;
  }
  try {
    const parsed: unknown = JSON.parse(await adapter.read(path));
    if (parsed && typeof parsed === "object") {
      return parsed;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

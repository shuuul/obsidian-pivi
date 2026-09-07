/**
 * App-layer host platform adapters for product UI.
 * UI must import path/vault helpers and host service contract types from here —
 * not from @pivi/obsidian-host.
 */
import { isOfficialObsidianCliEnabled, ObsidianVaultApi } from "@pivi/obsidian-host";
import {
  expandHomePath,
  getVaultPath,
  isPathWithinVault,
  normalizePathForComparison,
  normalizePathForFilesystem,
  normalizePathForVault,
} from "@pivi/obsidian-host/path";
import type { App } from "obsidian";

export {
  expandHomePath,
  getVaultPath,
  isOfficialObsidianCliEnabled,
  isPathWithinVault,
  normalizePathForComparison,
  normalizePathForFilesystem,
  normalizePathForVault,
};

export type {
  AppMcpOAuth,
  AppMcpServerProbeProvider,
  AppMcpServerTester,
  AppMcpStorage,
  AppMcpToolProvider,
  AppMcpToolSummary,
} from "@pivi/agent/mcp/ports";
export type {
  AppModelReadinessProvider,
  AppModelReadinessStatus,
  AppModelTestResult,
} from "@pivi/agent/settings/modelReadiness";
export type {
  AppSkillProvider,
  AppSkillSummary,
} from "@pivi/agent/skills/skillProvider";

/** Notify Obsidian that a vault path changed (file history / UI refresh). */
export function triggerVaultModify(app: App, vaultRelativePath: string): void {
  const vaultApi = new ObsidianVaultApi(app);
  vaultApi.triggerVaultModify(vaultRelativePath);
}

const slashBadgeNavigators = new WeakMap<App, (name: string) => Promise<void>>();

/** Settings composition owns slash destinations; shared badge adapters only request navigation. */
export function registerSlashBadgeNavigation(app: App, navigate: (name: string) => Promise<void>): () => void {
  slashBadgeNavigators.set(app, navigate);
  return () => {
    if (slashBadgeNavigators.get(app) === navigate) slashBadgeNavigators.delete(app);
  };
}

export async function navigateSlashBadge(app: App, name: string): Promise<void> {
  await slashBadgeNavigators.get(app)?.(name);
}

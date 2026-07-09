/**
 * App-layer host platform adapters for product UI.
 * UI must import path/vault helpers and host service contract types from here —
 * not from @pivi/obsidian-host.
 */
import { isOfficialObsidianCliEnabled, ObsidianVaultApi } from "@pivi/obsidian-host";
import {
  expandHomePath,
  getVaultPath,
  normalizePathForComparison,
  normalizePathForFilesystem,
  normalizePathForVault,
} from "@pivi/obsidian-host/path";
import type { App } from "obsidian";

export {
  expandHomePath,
  getVaultPath,
  isOfficialObsidianCliEnabled,
  normalizePathForComparison,
  normalizePathForFilesystem,
  normalizePathForVault,
};

export type {
  AgentSettingsTabRenderer,
  AgentSettingsTabRendererContext,
  AppMcpOAuth,
  AppMcpServerProbeProvider,
  AppMcpServerTester,
  AppMcpStorage,
  AppMcpToolProvider,
  AppMcpToolSummary,
  AppModelReadinessProvider,
  AppModelReadinessStatus,
  AppModelTestResult,
  AppSkillProvider,
  AppSkillSummary,
  WorkspaceInitContext,
} from "@pivi/obsidian-host/serviceContracts";

/** Notify Obsidian that a vault path changed (file history / UI refresh). */
export function triggerVaultModify(app: App, vaultRelativePath: string): void {
  const vaultApi = new ObsidianVaultApi(app);
  vaultApi.triggerVaultModify(vaultRelativePath);
}

import type { Plugin } from "obsidian";

import type { SettingsFacade, WorkspaceFacade } from "@/app/hostContracts";
import { PiviSettingTabHost } from "@/app/ui/PiviSettingTabHost";

export function registerPiviSettings(
  plugin: Plugin,
  settings: SettingsFacade,
  workspace: WorkspaceFacade,
): void {
  plugin.addSettingTab(
    new PiviSettingTabHost(plugin.app, plugin, settings, () => workspace.ensureWorkspaceServices()),
  );
}

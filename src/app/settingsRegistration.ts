import { PiviSettingTabHost } from "@/app/ui/PiviSettingTabHost";
import type PiviPlugin from "@/main"

export function registerPiviSettings(plugin: PiviPlugin): void {
  plugin.addSettingTab(
    new PiviSettingTabHost(plugin.app, plugin, () => plugin.ensureWorkspaceServices()),
  );
}

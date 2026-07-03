import type PiviPlugin from "@/main"
import { PiviSettingTab } from "@/ui/settings/PiviSettings";

export function registerPiviSettings(plugin: PiviPlugin): void {
  plugin.addSettingTab(new PiviSettingTab(plugin.app, plugin));
}

import { SETTINGS_PAGES } from "@pivi/pivi-react/settings";
import type { Plugin } from "obsidian";
import { Notice } from "obsidian";

import type { SettingsFacade, WorkspaceFacade } from "@/app/hostContracts";
import { registerSlashBadgeNavigation } from "@/app/hostPlatform";
import { t } from "@/app/i18n";
import { PiviSettingTabHost } from "@/app/ui/PiviSettingTabHost";
import { openNativeSettingsPage } from "@/ui/shared/utils/obsidianPrivateApi";

export function registerPiviSettings(
  plugin: Plugin,
  settings: SettingsFacade,
  workspace: WorkspaceFacade,
): void {
  plugin.addSettingTab(
    new PiviSettingTabHost(plugin.app, plugin, settings, () => workspace.ensureWorkspaceServices()),
  );
  let disposed = false;
  plugin.register(() => { disposed = true; });
  plugin.register(registerSlashBadgeNavigation(plugin.app, async (name) => {
    try {
      const services = await workspace.ensureWorkspaceServices();
      const entries = await services.slashCommandCatalog.listDropdownEntries({ includeBuiltIns: true });
      if (disposed) return;
      const entry = entries.find((item) => item.name.toLowerCase() === name.toLowerCase());
      const page = entry?.kind === 'skill' ? 'skills' : 'commands';
      if (!openNativeSettingsPage(plugin.app, 'pivi', t(SETTINGS_PAGES[page].labelKey))) {
        new Notice(`${t('common.error')}: /${name}`);
      }
    } catch {
      if (!disposed) new Notice(`${t('common.error')}: /${name}`);
    }
  }));
}

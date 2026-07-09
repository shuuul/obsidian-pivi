import { Notice, Setting } from "obsidian";

import { t } from "@/i18n";

import type { PiviSettingsTabRenderContext } from "../piviSettingsTabs";

export function renderSessionFilesSection(
  ctx: PiviSettingsTabRenderContext,
  container: HTMLElement,
): void {
  new Setting(container).setName(t("settings.sessionFiles.heading")).setHeading();

  new Setting(container)
    .setName(t("settings.sessionFiles.deleteRemoved.name"))
    .setDesc(t("settings.sessionFiles.deleteRemoved.desc"))
    .addButton((button) => {
      button
        .setButtonText(t("settings.sessionFiles.deleteRemoved.button"))
        .setClass("mod-warning")
        .onClick(async () => {
          button.setDisabled(true);
          try {
            const deletedCount = await ctx.plugin.purgeDeletedSessionFiles();
            new Notice(
              t("settings.sessionFiles.deleteRemoved.success", {
                count: deletedCount,
              }),
            );
          } catch {
            new Notice(t("settings.sessionFiles.deleteRemoved.failed"));
          } finally {
            button.setDisabled(false);
          }
        });
    });
}

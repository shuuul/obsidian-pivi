import {
  type ButtonComponent,
  Notice,
  Setting,
} from "obsidian";

import type { PiviSettingsHost } from "@/app/hostContracts";
import type {
  NoteToolbarItemStyle,
  NoteToolbarSetupResult,
} from "@/app/noteToolbarIntegration";
import { t } from "@/i18n";

export interface NoteToolbarIntegrationSectionOptions {
  container: HTMLElement;
  plugin: PiviSettingsHost;
}

export function renderNoteToolbarIntegrationSection(
  options: NoteToolbarIntegrationSectionOptions,
): void {
  new Setting(options.container)
    .setName(t("settings.noteToolbar.heading"))
    .setHeading();

  const buttons: ButtonComponent[] = [];
  const runSetup = async (
    itemStyle: NoteToolbarItemStyle,
    activeButton: ButtonComponent,
    idleText: string,
  ): Promise<void> => {
    for (const button of buttons) button.setDisabled(true);
    activeButton.setButtonText(t("settings.noteToolbar.settingUp"));
    try {
      const result = await options.plugin.setupNoteToolbarIntegration(itemStyle);
      new Notice(
        formatResult(result),
        result.status === "failed" ? 7000 : 5000,
      );
    } finally {
      for (const button of buttons) button.setDisabled(false);
      activeButton.setButtonText(idleText);
    }
  };

  new Setting(options.container)
    .setDesc(t("settings.noteToolbar.desc"))
    .addButton((button) => {
      const idleText = t("settings.noteToolbar.setupLabelAndIcon");
      buttons.push(button);
      button
        .setButtonText(idleText)
        .onClick(() => runSetup("label-and-icon", button, idleText));
    })
    .addButton((button) => {
      const idleText = t("settings.noteToolbar.setupIconOnly");
      buttons.push(button);
      button
        .setButtonText(idleText)
        .onClick(() => runSetup("icon-only", button, idleText));
    });
}

function formatResult(result: NoteToolbarSetupResult): string {
  switch (result.status) {
    case "installed":
      return t("settings.noteToolbar.installed");
    case "already-installed":
      return t("settings.noteToolbar.alreadyInstalled");
    case "style-settings-opened":
      return t("settings.noteToolbar.styleSettingsOpened");
    case "needs-text-toolbar":
      return result.pluginInstalled
        ? t("settings.noteToolbar.pluginInstalledNeedsToolbar")
        : t("settings.noteToolbar.needsToolbar");
    case "plugin-installation-opened":
      return t("settings.noteToolbar.installationOpened");
    case "manual-setup-opened":
      return t("settings.noteToolbar.manualSetupOpened");
    case "unsupported-note-toolbar-version":
      return t("settings.noteToolbar.unsupportedVersion", {
        version: result.version ?? "unknown",
      });
    case "invalid-config":
      return t("settings.noteToolbar.invalidConfig");
    case "verification-failed":
      return t("settings.noteToolbar.verificationFailed");
    case "failed":
      return t("settings.noteToolbar.failed", {
        message: result.error ?? t("settings.noteToolbar.unknownError"),
      });
  }
}

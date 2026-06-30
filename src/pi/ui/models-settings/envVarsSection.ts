import { Setting } from "obsidian";

import { getPiAgentSettings, updatePiAgentSettings } from "../../settings";
import type { PiModelsSettingsContext } from "./types";

export function renderPiAgentSetupSection(
  container: HTMLElement,
  context: PiModelsSettingsContext,
): void {
  const settingsBag = context.plugin.settings as unknown as Record<
    string,
    unknown
  >;
  const piSettings = getPiAgentSettings(settingsBag);

  new Setting(container)
    .setName("Pi agent environment variables")
    .setDesc(
      "Extra global environment variables passed to the in-process Pi agent.",
    )
    .addTextArea((text) => {
      text
        .setPlaceholder("Enter environment variables (e.g. Key=value)...")
        .setValue(piSettings.environmentVariables)
        .onChange(async (value) => {
          updatePiAgentSettings(settingsBag, { environmentVariables: value });
          await context.plugin.saveSettings();
          context.onEnvironmentChanged?.();
        });
      text.inputEl.rows = 6;
      text.inputEl.cols = 50;
      text.inputEl.addClass("pivi-settings-env-textarea");
      text.inputEl.dataset.envScope = "agent";
    });
}

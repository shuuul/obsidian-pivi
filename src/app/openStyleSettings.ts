import { openExternalUrl } from "@pivi/obsidian-host/openExternalUrl";
import type { App } from "obsidian";

const STYLE_SETTINGS_PLUGIN_ID = "obsidian-style-settings";
const STYLE_SETTINGS_MARKETPLACE_URI =
  `obsidian://show-plugin?id=${STYLE_SETTINGS_PLUGIN_ID}`;

type SettingsNavigator = {
  pluginTabs?: Array<{ id?: string }>;
  openTabById?: (id: string) => unknown;
};

/**
 * Open the Style Settings plugin tab when installed; otherwise open its
 * marketplace URI. Returns true when the settings tab was opened in-app.
 */
export async function openStyleSettingsOrMarketplace(app: App): Promise<boolean> {
  const navigator = (app as App & { setting?: SettingsNavigator }).setting;
  if (
    navigator?.openTabById &&
    navigator.pluginTabs?.some((tab) => tab.id === STYLE_SETTINGS_PLUGIN_ID)
  ) {
    navigator.openTabById(STYLE_SETTINGS_PLUGIN_ID);
    return true;
  }

  await openExternalUrl(STYLE_SETTINGS_MARKETPLACE_URI);
  return false;
}

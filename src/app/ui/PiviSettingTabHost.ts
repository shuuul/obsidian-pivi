import {
  type MountedSurface,
  mountSettings,
} from "@pivi/obsidian-ui/mount";
import type { App } from "obsidian";
import { Notice, PluginSettingTab } from "obsidian";

import type { PiviPluginHost } from "@/app/hostContracts";
import { appI18n, type Locale, setLocale, t } from "@/app/i18n";
import { createSettingsUiPorts } from "@/app/ui/createUiPorts";
import { getActiveWindow } from "@/ui/shared/dom";

export class PiviSettingTabHost extends PluginSettingTab {
  plugin: PiviPluginHost;
  private mountedSurface: MountedSurface | null = null;
  private mountGeneration = 0;

  constructor(app: App, plugin: PiviPluginHost) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    this.containerEl.empty();
    const generation = ++this.mountGeneration;
    setLocale(this.plugin.settings.language as Locale);
    void this.mountReactSettings(generation);
  }

  hide(): void {
    this.mountGeneration++;
    const mounted = this.mountedSurface;
    this.mountedSurface = null;
    if (mounted) void mounted.dispose();
    this.containerEl.empty();
  }

  private async mountReactSettings(generation: number): Promise<void> {
    const ownerDocument = this.containerEl.ownerDocument;
    const ownerWindow = getActiveWindow(this.containerEl);

    const previous = this.mountedSurface;
    this.mountedSurface = null;
    if (previous) await previous.dispose();

    try {
      const mounted = await mountSettings({
        container: this.containerEl,
        ownerDocument,
        ownerWindow,
        portalContainer: ownerDocument.body,
        i18n: appI18n,
        ports: createSettingsUiPorts(this.plugin),
      });
      if (generation !== this.mountGeneration) {
        await mounted.dispose();
        return;
      }
      this.mountedSurface = mounted;
    } catch (error) {
      if (generation !== this.mountGeneration) return;
      const detail = error instanceof Error ? error.message : String(error);
      new Notice(`${t("common.error")}: ${detail}`);
    }
  }
}

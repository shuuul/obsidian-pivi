import {
  type MountedSurface,
  mountSettings,
} from "@pivi/pivi-react/mount";
import type { App } from "obsidian";
import { Notice, PluginSettingTab } from "obsidian";

import type {
  PiviPluginHost,
  PiviPluginWorkspace,
} from "@/app/hostContracts";
import { appI18n, type Locale, setLocale, t } from "@/app/i18n";
import { createSettingsUiPorts } from "@/app/ui/createUiPorts";
import { obsidianPresentationPlatform } from "@/app/ui/obsidianPresentationPlatform";
import { getActiveWindow } from "@/ui/shared/dom";

export class PiviSettingTabHost extends PluginSettingTab {
  plugin: PiviPluginHost;
  private readonly getWorkspace: () => Promise<PiviPluginWorkspace>;
  private mountedSurface: MountedSurface | null = null;
  private mountGeneration = 0;

  constructor(
    app: App,
    plugin: PiviPluginHost,
    getWorkspace: () => Promise<PiviPluginWorkspace>,
  ) {
    super(app, plugin);
    this.plugin = plugin;
    this.getWorkspace = getWorkspace;
  }

  display(): void {
    this.containerEl.empty();
    const generation = ++this.mountGeneration;
    setLocale(this.plugin.settings.locale as Locale);
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
      const workspace = await this.getWorkspace();
      if (generation !== this.mountGeneration) return;
      const mounted = await mountSettings({
        container: this.containerEl,
        ownerDocument,
        ownerWindow,
        portalContainer: ownerDocument.body,
        i18n: appI18n,
        platform: obsidianPresentationPlatform,
        ports: createSettingsUiPorts(this.plugin, workspace),
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

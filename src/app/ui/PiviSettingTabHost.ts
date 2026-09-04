import { PluginLogger } from "@pivi/agent/logging/pluginLogger";
import {
  getSettingsPageSearchAliases,
  type MountedSurface,
  mountSettingsPage,
} from "@pivi/pivi-react/mount";
import {
  SETTINGS_PAGES,
  SETTINGS_ROOT_LAYOUT,
  type SettingsPageId,
  type SettingsRootEntry,
} from "@pivi/pivi-react/settings";
import type {
  SettingDefinitionItem,
  SettingDefinitionPage,
  SettingGroupItem,
} from "obsidian";
import { Notice, PluginSettingTab } from "obsidian";

import type {
  PiviPluginWorkspace,
  SettingsFacade,
} from "@/app/hostContracts";
import { appI18n, type Locale, setLocale, t } from "@/app/i18n";
import { createSettingsUiPorts } from "@/app/ui/createUiPorts";
import { obsidianPresentationPlatform } from "@/app/ui/obsidianPresentationPlatform";
import { getActiveWindow } from "@/ui/shared/dom";

const logger = new PluginLogger("PiviSettingTabHost");

function refreshSettingDefinitions(tab: object): void {
  const update: unknown = (tab as { update?: unknown }).update;
  if (typeof update === "function") update.call(tab);
}

const HOST_SURFACE_RESET_CLASS = "pivi-settings-host-surface-reset";

/** Tag Obsidian's implicit single-item group surface so product CSS can neutralize it. */
function neutralizeImplicitHostSurface(settingEl: HTMLElement): void {
  const items = settingEl.parentElement;
  if (!items || items.childElementCount !== 1) return;
  items.classList.add(HOST_SURFACE_RESET_CLASS);
  const previous = items.previousElementSibling;
  if (previous?.classList.contains("setting-group-search")) {
    previous.classList.add(HOST_SURFACE_RESET_CLASS);
  }
}

function decorateNativePageHeader(settingEl: HTMLElement): void {
  const page = settingEl.closest(".setting-page-content");
  const titlebar = page?.querySelector<HTMLElement>(".setting-page-titlebar");
  titlebar?.classList.add("pivi-settings-native-titlebar");
  titlebar?.querySelector<HTMLElement>(".setting-page-title")
    ?.classList.add("pivi-settings-native-title");
  const back = titlebar?.querySelector<HTMLElement>(".setting-page-back-button");
  back?.classList.add("pivi-settings-native-back");
  back?.querySelector<HTMLElement>("svg")?.classList.add("pivi-settings-native-back-icon");
}

export class PiviSettingTabHost extends PluginSettingTab {
  plugin: SettingsFacade;
  private readonly getWorkspace: () => Promise<PiviPluginWorkspace>;
  private readonly liveSurfaces = new Set<MountedSurface>();
  private readonly mountGenerations = new Map<SettingsPageId, number>();
  private readonly mountedByPage = new Map<SettingsPageId, MountedSurface>();

  constructor(
    app: ConstructorParameters<typeof PluginSettingTab>[0],
    plugin: ConstructorParameters<typeof PluginSettingTab>[1],
    host: SettingsFacade,
    getWorkspace: () => Promise<PiviPluginWorkspace>,
  ) {
    super(app, plugin);
    this.plugin = host;
    this.getWorkspace = getWorkspace;
    setLocale(host.settings.locale as Locale);
    plugin.register(appI18n.subscribe(() => {
      refreshSettingDefinitions(this);
    }));
    plugin.register(() => {
      this.disposeLiveSurfaces();
    });
  }

  getSettingDefinitions(): SettingDefinitionItem[] {
    return SETTINGS_ROOT_LAYOUT.map((entry) => this.mapRootEntry(entry));
  }

  disposeLiveSurfaces(): void {
    for (const [page, generation] of this.mountGenerations) {
      this.mountGenerations.set(page, generation + 1);
    }
    this.mountedByPage.clear();
    const surfaces = [...this.liveSurfaces];
    this.liveSurfaces.clear();
    for (const surface of surfaces) {
      void surface.dispose();
    }
  }

  private mapRootEntry(entry: SettingsRootEntry): SettingDefinitionItem {
    if (entry.kind === "page") {
      return this.mapPage(entry.page);
    }
    if (entry.kind === "content") {
      return this.mapRenderItem(entry.page, true);
    }
    return {
      type: "group",
      heading: t(entry.labelKey),
      items: entry.items.map((item) => this.mapPage(item.page)),
    };
  }

  private mapPage(page: SettingsPageId): SettingDefinitionPage {
    const descriptor = SETTINGS_PAGES[page];
    return {
      type: "page",
      name: t(descriptor.labelKey),
      desc: t(descriptor.descriptionKey),
      items: [this.mapRenderItem(page)],
    };
  }

  private mapRenderItem(page: SettingsPageId, inline = false): SettingGroupItem {
    const descriptor = SETTINGS_PAGES[page];
    return {
      name: t(descriptor.labelKey),
      desc: t(descriptor.descriptionKey),
      aliases: getSettingsPageSearchAliases(appI18n, page),
      render: (setting) => {
        setting.settingEl.empty();
        setting.settingEl.addClass("pivi-settings-definition-host");
        if (inline) setting.settingEl.addClass("pivi-settings-definition-host--inline");
        neutralizeImplicitHostSurface(setting.settingEl);
        decorateNativePageHeader(setting.settingEl);
        return this.mountPageContent(page, setting.settingEl);
      },
    };
  }

  private mountPageContent(page: SettingsPageId, container: HTMLElement): () => void {
    const generation = (this.mountGenerations.get(page) ?? 0) + 1;
    this.mountGenerations.set(page, generation);
    void this.mountPage(page, container, generation);
    return () => {
      if (generation !== this.mountGenerations.get(page)) return;
      this.mountGenerations.set(page, generation + 1);
      const mounted = this.mountedByPage.get(page);
      this.mountedByPage.delete(page);
      if (mounted) {
        this.liveSurfaces.delete(mounted);
        void mounted.dispose();
      }
      container.empty();
    };
  }

  private async mountPage(
    page: SettingsPageId,
    container: HTMLElement,
    generation: number,
  ): Promise<void> {
    const ownerDocument = container.ownerDocument;
    const ownerWindow = getActiveWindow(container);

    const previous = this.mountedByPage.get(page);
    this.mountedByPage.delete(page);
    if (previous) {
      this.liveSurfaces.delete(previous);
      await previous.dispose();
    }

    try {
      const workspace = await this.getWorkspace();
      if (generation !== this.mountGenerations.get(page)) return;
      const mounted = await mountSettingsPage({
        page,
        container,
        ownerDocument,
        ownerWindow,
        portalContainer: ownerDocument.body,
        i18n: appI18n,
        platform: obsidianPresentationPlatform,
        ports: createSettingsUiPorts(this.plugin, workspace),
      });
      if (generation !== this.mountGenerations.get(page)) {
        await mounted.dispose();
        return;
      }
      this.mountedByPage.set(page, mounted);
      this.liveSurfaces.add(mounted);
    } catch (error) {
      if (generation !== this.mountGenerations.get(page)) return;
      logger.error("Failed to mount settings page", error);
      const detail = error instanceof Error ? error.message : String(error);
      new Notice(`${t("common.error")}: ${detail}`);
    }
  }
}

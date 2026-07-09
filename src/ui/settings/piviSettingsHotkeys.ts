import {
  TOOL_OBSIDIAN_ATTACHMENT,
  TOOL_OBSIDIAN_BASH,
  TOOL_OBSIDIAN_DELETE,
  TOOL_OBSIDIAN_EDIT,
  TOOL_OBSIDIAN_GENERATE_IMAGE,
  TOOL_OBSIDIAN_HISTORY,
  TOOL_OBSIDIAN_LINKS,
  TOOL_OBSIDIAN_LIST,
  TOOL_OBSIDIAN_LIST_EXTERNAL,
  TOOL_OBSIDIAN_MKDIR,
  TOOL_OBSIDIAN_MOVE,
  TOOL_OBSIDIAN_NOTE_INFO,
  TOOL_OBSIDIAN_OPEN,
  TOOL_OBSIDIAN_PROPERTIES,
  TOOL_OBSIDIAN_READ,
  TOOL_OBSIDIAN_READ_EXTERNAL,
  TOOL_OBSIDIAN_SEARCH,
  TOOL_OBSIDIAN_TASKS,
  TOOL_OBSIDIAN_WRITE,
} from "@pivi/pivi-agent-core/tools";
import type { App } from "obsidian";
import { Platform } from "obsidian";

import type { TranslationKey } from "@/i18n";
import { t } from "@/i18n";

type ObsidianHotkey = { modifiers: string[]; key: string };
type ObsidianHotkeyManager = {
  customKeys?: Record<string, ObsidianHotkey[] | undefined>;
  defaultKeys?: Record<string, ObsidianHotkey[] | undefined>;
};
type ObsidianHotkeyTab = {
  searchInputEl?: HTMLInputElement;
  searchComponent?: { inputEl?: HTMLInputElement };
  updateHotkeyVisibility?: () => void;
};
type ObsidianSettingsController = {
  activeTab?: ObsidianHotkeyTab;
  open: () => void;
  openTabById: (id: string) => void;
};
export type ScrollSnapshot = {
  el: HTMLElement;
  top: number;
  left: number;
};
type AppWithHotkeyInternals = App & {
  hotkeyManager?: ObsidianHotkeyManager;
  setting?: ObsidianSettingsController;
};

export type ToolSettingsRow = {
  name: string;
  labelKey: TranslationKey;
  descKey: TranslationKey;
  requiresCodex?: boolean;
  requiresOfficialCli?: boolean;
  requiresExternalRead?: boolean;
};

export const TOOL_SETTINGS_ROWS: ToolSettingsRow[] = [
  { name: TOOL_OBSIDIAN_READ, labelKey: "tools.display.read", descKey: "tools.display.readDesc" },
  { name: TOOL_OBSIDIAN_EDIT, labelKey: "tools.display.edit", descKey: "tools.display.editDesc" },
  { name: TOOL_OBSIDIAN_WRITE, labelKey: "tools.display.write", descKey: "tools.display.writeDesc" },
  { name: TOOL_OBSIDIAN_SEARCH, labelKey: "tools.display.search", descKey: "tools.display.searchDesc" },
  { name: TOOL_OBSIDIAN_NOTE_INFO, labelKey: "tools.display.noteInfo", descKey: "tools.display.noteInfoDesc" },
  { name: TOOL_OBSIDIAN_LINKS, labelKey: "tools.display.links", descKey: "tools.display.linksDesc" },
  { name: TOOL_OBSIDIAN_PROPERTIES, labelKey: "tools.display.properties", descKey: "tools.display.propertiesDesc" },
  { name: TOOL_OBSIDIAN_TASKS, labelKey: "tools.display.tasks", descKey: "tools.display.tasksDesc", requiresOfficialCli: true },
  { name: TOOL_OBSIDIAN_HISTORY, labelKey: "tools.display.history", descKey: "tools.display.historyDesc", requiresOfficialCli: true },
  { name: TOOL_OBSIDIAN_DELETE, labelKey: "tools.display.delete", descKey: "tools.display.deleteDesc" },
  { name: TOOL_OBSIDIAN_MOVE, labelKey: "tools.display.move", descKey: "tools.display.moveDesc" },
  { name: TOOL_OBSIDIAN_LIST, labelKey: "tools.display.list", descKey: "tools.display.listDesc" },
  { name: TOOL_OBSIDIAN_READ_EXTERNAL, labelKey: "tools.display.readExternal", descKey: "tools.display.readExternalDesc", requiresExternalRead: true },
  { name: TOOL_OBSIDIAN_LIST_EXTERNAL, labelKey: "tools.display.listExternal", descKey: "tools.display.listExternalDesc", requiresExternalRead: true },
  { name: TOOL_OBSIDIAN_MKDIR, labelKey: "tools.display.mkdir", descKey: "tools.display.mkdirDesc" },
  { name: TOOL_OBSIDIAN_OPEN, labelKey: "tools.display.open", descKey: "tools.display.openDesc" },
  { name: TOOL_OBSIDIAN_ATTACHMENT, labelKey: "tools.display.attachment", descKey: "tools.display.attachmentDesc" },
  { name: TOOL_OBSIDIAN_GENERATE_IMAGE, labelKey: "tools.display.generateImage", descKey: "tools.display.generateImageDesc", requiresCodex: true },
  { name: TOOL_OBSIDIAN_BASH, labelKey: "tools.display.bash", descKey: "tools.display.bashDesc" },
];

export function getScrollableAncestors(el: HTMLElement): ScrollSnapshot[] {
  const snapshots: ScrollSnapshot[] = [];
  let current: HTMLElement | null = el;

  while (current) {
    if (
      current.scrollTop > 0 ||
      current.scrollLeft > 0 ||
      current.scrollHeight > current.clientHeight
    ) {
      snapshots.push({
        el: current,
        top: current.scrollTop,
        left: current.scrollLeft,
      });
    }
    current = current.parentElement;
  }

  return snapshots;
}

function formatHotkey(hotkey: ObsidianHotkey): string {
  const isMac = Platform.isMacOS;
  const modMap: Record<string, string> = isMac
    ? { Mod: "⌘", Ctrl: "⌃", Alt: "⌥", Shift: "⇧", Meta: "⌘" }
    : { Mod: "Ctrl", Ctrl: "Ctrl", Alt: "Alt", Shift: "Shift", Meta: "Win" };

  const mods = hotkey.modifiers.map((modifier) => modMap[modifier] || modifier);
  const key = hotkey.key.length === 1 ? hotkey.key.toUpperCase() : hotkey.key;

  return isMac ? [...mods, key].join("") : [...mods, key].join("+");
}

function openHotkeySettings(app: App): void {
  const setting = (app as AppWithHotkeyInternals).setting;
  if (!setting) {
    return;
  }

  setting.open();
  setting.openTabById("hotkeys");
  window.setTimeout(() => {
    const tab = setting.activeTab;
    if (!tab) {
      return;
    }

    const searchEl = tab.searchInputEl ?? tab.searchComponent?.inputEl;
    if (!searchEl) {
      return;
    }

    searchEl.value = "Pivi";
    tab.updateHotkeyVisibility?.();
  }, 100);
}

function getHotkeyForCommand(app: App, commandId: string): string | null {
  const hotkeyManager = (app as AppWithHotkeyInternals).hotkeyManager;
  if (!hotkeyManager) return null;

  const customHotkeys = hotkeyManager.customKeys?.[commandId];
  const defaultHotkeys = hotkeyManager.defaultKeys?.[commandId];
  const hotkeys =
    customHotkeys && customHotkeys.length > 0 ? customHotkeys : defaultHotkeys;

  if (!hotkeys || hotkeys.length === 0) return null;

  return hotkeys.map(formatHotkey).join(", ");
}

export function addHotkeySettingRow(
  containerEl: HTMLElement,
  app: App,
  commandId: string,
  translationPrefix: string,
): void {
  const hotkey = getHotkeyForCommand(app, commandId);
  const item = containerEl.createDiv({ cls: "pivi-hotkey-item" });
  item.createSpan({
    cls: "pivi-hotkey-name",
    text: t(`${translationPrefix}.name` as TranslationKey),
  });
  if (hotkey) {
    item.createSpan({ cls: "pivi-hotkey-badge", text: hotkey });
  }
  item.addEventListener("click", () => openHotkeySettings(app));
}

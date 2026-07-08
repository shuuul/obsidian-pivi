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
  label: string;
  description: string;
  requiresCodex?: boolean;
  requiresOfficialCli?: boolean;
  requiresExternalRead?: boolean;
};

export const TOOL_SETTINGS_ROWS: ToolSettingsRow[] = [
  { name: TOOL_OBSIDIAN_READ, label: "Read", description: "Read note bodies by vault-relative path or wikilink-style file name." },
  { name: TOOL_OBSIDIAN_EDIT, label: "Edit", description: "Replace exact text in existing notes. Preferred for partial edits." },
  { name: TOOL_OBSIDIAN_WRITE, label: "Write", description: "Create notes, append/prepend content, or intentionally overwrite full notes." },
  { name: TOOL_OBSIDIAN_SEARCH, label: "Search", description: "Search note text, tags, or list markdown files in folders." },
  { name: TOOL_OBSIDIAN_NOTE_INFO, label: "Note info", description: "Read metadata, tags, outgoing links, and frontmatter." },
  { name: TOOL_OBSIDIAN_LINKS, label: "Links", description: "Read outgoing links or backlinks for a note." },
  { name: TOOL_OBSIDIAN_PROPERTIES, label: "Properties", description: "List, read, set, or remove YAML frontmatter properties.", requiresOfficialCli: true },
  { name: TOOL_OBSIDIAN_TASKS, label: "Tasks", description: "List or toggle markdown tasks.", requiresOfficialCli: true },
  { name: TOOL_OBSIDIAN_HISTORY, label: "History", description: "List, read, and restore Obsidian file history versions.", requiresOfficialCli: true },
  { name: TOOL_OBSIDIAN_DELETE, label: "Delete", description: "Move vault files or folders to trash." },
  { name: TOOL_OBSIDIAN_MOVE, label: "Move", description: "Rename or move vault files/folders and let Obsidian update links." },
  { name: TOOL_OBSIDIAN_LIST, label: "List", description: "List direct children of vault folders, including attachments." },
  { name: TOOL_OBSIDIAN_READ_EXTERNAL, label: "Read external", description: "Read files under allowed external directories by absolute path.", requiresExternalRead: true },
  { name: TOOL_OBSIDIAN_LIST_EXTERNAL, label: "List external", description: "List direct children of allowed external directories by absolute path.", requiresExternalRead: true },
  { name: TOOL_OBSIDIAN_MKDIR, label: "Mkdir", description: "Create folders in the vault." },
  { name: TOOL_OBSIDIAN_OPEN, label: "Open", description: "Open a vault file in the Obsidian workspace." },
  { name: TOOL_OBSIDIAN_ATTACHMENT, label: "Attachment", description: "Resolve attachment metadata/resource URLs or available attachment paths." },
  { name: TOOL_OBSIDIAN_GENERATE_IMAGE, label: "Generate image", description: "Generate images with Codex, save them as attachments, and optionally insert embeds into notes.", requiresCodex: true },
  { name: TOOL_OBSIDIAN_BASH, label: "Bash", description: "Run one-line shell commands that match the Bash allowlist configured above." },
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

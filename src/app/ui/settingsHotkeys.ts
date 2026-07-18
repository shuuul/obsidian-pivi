import type { App } from 'obsidian';
import { Platform } from 'obsidian';

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
type AppWithHotkeyInternals = App & {
  hotkeyManager?: ObsidianHotkeyManager;
  setting?: ObsidianSettingsController;
};

export const SETTINGS_HOTKEY_ROWS = [
  { commandId: 'pivi:open-view', labelKey: 'settings.openChatHotkey.name' },
  { commandId: 'pivi:new-session', labelKey: 'settings.newSessionHotkey.name' },
  { commandId: 'pivi:new-tab', labelKey: 'settings.newTabHotkey.name' },
  { commandId: 'pivi:close-current-tab', labelKey: 'settings.closeTabHotkey.name' },
  { commandId: 'pivi:add-selection-to-chat-input', labelKey: 'settings.addSelectionHotkey.name' },
] as const;

function formatHotkey(hotkey: ObsidianHotkey): string {
  const isMac = Platform.isMacOS;
  const modMap: Record<string, string> = isMac
    ? { Mod: '⌘', Ctrl: '⌃', Alt: '⌥', Shift: '⇧', Meta: '⌘' }
    : { Mod: 'Ctrl', Ctrl: 'Ctrl', Alt: 'Alt', Shift: 'Shift', Meta: 'Win' };
  const mods = hotkey.modifiers.map((modifier) => modMap[modifier] || modifier);
  const key = hotkey.key.length === 1 ? hotkey.key.toUpperCase() : hotkey.key;
  return isMac ? [...mods, key].join('') : [...mods, key].join('+');
}

export function getHotkeyForCommand(app: App, commandId: string): string | null {
  const hotkeyManager = (app as AppWithHotkeyInternals).hotkeyManager;
  if (!hotkeyManager) return null;
  const customHotkeys = hotkeyManager.customKeys?.[commandId];
  const defaultHotkeys = hotkeyManager.defaultKeys?.[commandId];
  const hotkeys = customHotkeys && customHotkeys.length > 0 ? customHotkeys : defaultHotkeys;
  if (!hotkeys || hotkeys.length === 0) return null;
  return hotkeys.map(formatHotkey).join(', ');
}

export function openHotkeySettings(app: App): void {
  const setting = (app as AppWithHotkeyInternals).setting;
  if (!setting) return;
  setting.open();
  setting.openTabById('hotkeys');
  window.setTimeout(() => {
    const tab = setting.activeTab;
    if (!tab) return;
    const searchEl = tab.searchInputEl ?? tab.searchComponent?.inputEl;
    if (!searchEl) return;
    searchEl.value = 'Pivi';
    tab.updateHotkeyVisibility?.();
  }, 100);
}

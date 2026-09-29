import type { SettingsHotkeyRow } from '../settings/types';

export interface SettingsHotkeysPort {
  listHotkeys(): readonly SettingsHotkeyRow[];
  openHotkeySettings(): void;
}

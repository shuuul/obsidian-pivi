export interface SettingsEditorToolbarCommandEntry {
  readonly id: string;
  readonly name: string;
  /** Host icon id when the command declares one. */
  readonly iconId?: string;
}

export interface SettingsEditorToolbarPiviCommandEntry {
  readonly key: string;
  readonly name: string;
  readonly description?: string;
  /** Catalog icon id when the command declares one. */
  readonly icon?: string;
}

export interface SettingsEditorToolbarPort {
  listHostCommands(): readonly SettingsEditorToolbarCommandEntry[];
  listPiviCommands(): Promise<readonly SettingsEditorToolbarPiviCommandEntry[]>;
  listIconNames(): readonly string[];
  /** True when Note Toolbar's selected-text toolbar is active and Pivi's toolbar auto-yields. */
  isNoteToolbarTextToolbarActive(): boolean;
}

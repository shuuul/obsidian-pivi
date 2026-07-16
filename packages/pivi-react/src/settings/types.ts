export type SettingsTabId =
  | 'general'
  | 'models'
  | 'skills'
  | 'tools'
  | 'subagents'
  | 'commands';

export interface SettingsKeyboardNavigationSnapshot {
  readonly scrollUpKey: string;
  readonly scrollDownKey: string;
  readonly focusInputKey: string;
}

export interface SettingsGeneralSnapshot {
  readonly locale: string;
  readonly chatViewPlacement: 'right-sidebar' | 'left-sidebar' | 'main-tab';
  readonly tabBarPosition: 'input' | 'header';
  readonly enableAutoScroll: boolean;
  readonly deferMathRenderingDuringStreaming: boolean;
  readonly enableAutoTitleGeneration: boolean;
  readonly autoCompact: boolean;
  readonly autoCompactThresholdPercent: number;
  readonly autoCompactKeepRecentTokens: number;
  readonly userName: string;
  readonly excludedTags: readonly string[];
  readonly requireCommandOrControlEnterToSend: boolean;
  readonly keyboardNavigation: SettingsKeyboardNavigationSnapshot;
}

export interface SettingsHotkeyRow {
  readonly commandId: string;
  readonly labelKey: string;
  readonly hotkey: string | null;
}

export interface SettingsSubagentsSnapshot {
  readonly enabled: boolean;
  readonly allowBackground: boolean;
  readonly maxConcurrentSubagents: 1 | 2 | 3 | 4 | 8;
  readonly showActiveWorkShelf: boolean;
}

export interface SettingsUiSnapshotData {
  readonly general: SettingsGeneralSnapshot;
  readonly subagents: SettingsSubagentsSnapshot;
}

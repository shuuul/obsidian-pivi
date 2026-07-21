import type {
  EditorToolbarShortcut,
  EditorToolbarShortcutKind,
} from '@pivi/pivi-agent-core/foundation/settings';

export type SettingsEditorSelectionToolbarSnapshot = {
  readonly enabled: boolean;
  readonly shortcuts: readonly EditorToolbarShortcut[];
};

export type SettingsTabId =
  | 'general'
  | 'toolbar'
  | 'models'
  | 'skills'
  | 'tools'
  | 'subagents'
  | 'commands';

export type { EditorToolbarShortcutKind };

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
  readonly userName: string;
  readonly excludedTags: readonly string[];
  readonly requireCommandOrControlEnterToSend: boolean;
  readonly keyboardNavigation: SettingsKeyboardNavigationSnapshot;
  readonly editorSelectionToolbar: SettingsEditorSelectionToolbarSnapshot;
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
}

export interface SettingsUiSnapshotData {
  readonly general: SettingsGeneralSnapshot;
  readonly subagents: SettingsSubagentsSnapshot;
}

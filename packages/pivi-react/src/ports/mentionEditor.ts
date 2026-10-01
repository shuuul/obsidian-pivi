/** Handle returned by the mention prompt editor port after mounting. */
export interface SettingsMentionEditorHandle {
  getValue(): string;
  focus(): void;
  setDisabled(disabled: boolean): void;
  destroy(): void;
}

export interface SettingsMentionEditorCallbacks {
  onChange?(text: string): void;
}

/**
 * Mounts an imperative mention-capable prompt editor (`@` vault files/folders/
 * agents, `/` skills/MCP/tools/commands) into a React-owned empty container.
 * The persisted value is canonical plain text identical to composer-extracted
 * text; badges are editing-time presentation only.
 */
export interface SettingsMentionEditorPort {
  mount(
    container: HTMLElement,
    initialValue: string,
    callbacks: SettingsMentionEditorCallbacks,
  ): SettingsMentionEditorHandle;
}

export type SettingsFeedbackKind = 'success' | 'error' | 'pending';

export interface SettingsFeedbackMessage {
  readonly kind: SettingsFeedbackKind;
  readonly message: string;
}

/** Handle for a host notice that can be dismissed while an action is still running. */
export interface SettingsNoticeHandle {
  hide(): void;
}

/** Host-neutral channel for timely settings feedback; Obsidian maps it to Notice. */
export interface SettingsFeedbackPort {
  notify(message: string, timeout?: number): SettingsNoticeHandle | void;
}

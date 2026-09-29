export interface SettingsRuntimePort {
  refreshPrompt(): Promise<void>;
  refreshModelSelectors(): void;
}

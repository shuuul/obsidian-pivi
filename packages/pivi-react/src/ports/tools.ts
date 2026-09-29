import type { PersistentBashPermission, PersistentExternalDirectoryPermission } from '@pivi/agent/tools';

export interface SettingsToolRow {
  readonly name: string;
  readonly label: string;
  readonly description: string;
  readonly group: 'workspace-api' | 'host-cli' | 'pivi' | 'additional';
  readonly configuration?: 'read' | 'external-read' | 'bash' | 'command';
  readonly enabled: boolean;
  readonly available: boolean;
}

export interface SettingsToolsSettings {
  cliEnabled: boolean;
  cliAvailable: boolean;
  cliPath: string | null;
  cliTimeoutMs: number;
  allowCommand: boolean;
  commandAllowlist: readonly string[];
  allowBash: boolean;
  allowExternalRead: boolean;
  defaultReadMaxChars: number;
  bashPermissions: readonly PersistentBashPermission[];
  externalDirectories: readonly PersistentExternalDirectoryPermission[];
}

export interface SettingsToolsSettingsPatch {
  allowBash?: boolean;
  cliEnabled?: boolean;
  cliPath?: string | null;
  cliTimeoutMs?: number;
  allowCommand?: boolean;
  commandAllowlist?: readonly string[];
  allowExternalRead?: boolean;
  defaultReadMaxChars?: number;
  bashPermissions?: readonly PersistentBashPermission[];
  externalDirectories?: readonly PersistentExternalDirectoryPermission[];
}

export interface SettingsToolsPort {
  getSettings(): SettingsToolsSettings;
  listToolRows(): readonly SettingsToolRow[];
  setToolEnabled(name: string, enabled: boolean): Promise<void>;
  chooseExternalDirectory(current?: string): Promise<string | null>;
  validateExternalDirectory(path: string): Promise<{ valid: boolean; error?: string }>;
  saveSettings(patch: SettingsToolsSettingsPatch): Promise<void>;
}

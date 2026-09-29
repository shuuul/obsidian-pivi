import type { SettingsAboutPort } from './about';
import type { SettingsActionsPort, SettingsSnapshotPort } from './actions';
import type { SettingsCatalogPort } from './catalog';
import type { SettingsComplexPorts } from './complex';
import type { SettingsEditorToolbarPort } from './editorToolbar';
import type { SettingsEnvironmentPort } from './environment';
import type { SettingsFeedbackPort } from './feedback';
import type { SettingsHostIntegrationsPort, SettingsPersistencePort } from './hostIntegrations';
import type { SettingsHotkeysPort } from './hotkeys';
import type { SettingsMentionEditorPort } from './mentionEditor';
import type { SettingsPromptPort } from './prompt';

export interface SettingsPorts {
  feedback: SettingsFeedbackPort;
  snapshot: SettingsSnapshotPort;
  actions: SettingsActionsPort;
  complex: SettingsComplexPorts;
  persistence: SettingsPersistencePort;
  environment: SettingsEnvironmentPort;
  hotkeys: SettingsHotkeysPort;
  editorToolbar: SettingsEditorToolbarPort;
  catalog: SettingsCatalogPort;
  hostIntegrations: SettingsHostIntegrationsPort;
  mentionEditor: SettingsMentionEditorPort;
  about: SettingsAboutPort;
  prompt: SettingsPromptPort;
}

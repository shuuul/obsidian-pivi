import type { SettingsCommandsPort } from './commands';
import type { SettingsMcpPort } from './mcp';
import type { SettingsModelsPort } from './models';
import type { SettingsRuntimePort } from './runtime';
import type { SettingsSkillsPort } from './skills';
import type { SettingsToolsPort } from './tools';
import type { SettingsWebSearchPort } from './webSearch';

export interface SettingsComplexPorts {
  models: SettingsModelsPort;
  skills: SettingsSkillsPort;
  tools: SettingsToolsPort;
  webSearch: SettingsWebSearchPort;
  runtime: SettingsRuntimePort;
  commands: SettingsCommandsPort;
  mcp: SettingsMcpPort;
}

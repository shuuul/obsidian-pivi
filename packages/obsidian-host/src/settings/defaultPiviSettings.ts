import { type PiviSettings } from '@pivi/core/settings';
import {
  DEFAULT_AGENT_SETTINGS,
  DEFAULT_MODEL_KEY,
} from '@pivi/pi-runtime/settings/agentDefaults';

export const DEFAULT_PIVI_SETTINGS: PiviSettings = {
  userName: '',
  permissionMode: 'normal',
  model: DEFAULT_MODEL_KEY,
  thinkingBudget: 'off',
  thinkingLevel: 'medium',
  enableAutoTitleGeneration: true,
  titleGenerationModel: '',
  excludedTags: [],
  persistentExternalContextPaths: [],
  sharedEnvironmentVariables: '',
  envSnippets: [],
  customContextLimits: {},
  keyboardNavigation: {
    scrollUpKey: 'w',
    scrollDownKey: 's',
    focusInputKey: 'i',
  },
  requireCommandOrControlEnterToSend: false,
  locale: 'en',
  agentSettings: { ...DEFAULT_AGENT_SETTINGS },
  maxTabs: 3,
  tabBarPosition: 'input',
  enableAutoScroll: true,
  deferMathRenderingDuringStreaming: true,
  chatViewPlacement: 'right-sidebar',
  hiddenSlashCommands: [],
};

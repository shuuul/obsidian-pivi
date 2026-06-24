import { getDefaultHiddenSlashCommands } from '../../core/agent/commands/hiddenCommands';
import {
  DEFAULT_AGENT_SETTINGS,
  DEFAULT_MODEL_KEY,
} from '../../core/settings/agentDefaults';
import { type ObsiusSettings } from '../../core/types/settings';

export const DEFAULT_OBSIUS_SETTINGS: ObsiusSettings = {
  userName: '',

  permissionMode: 'normal',

  model: DEFAULT_MODEL_KEY,
  thinkingBudget: 'off',
  thinkingLevel: 'medium',
  enableAutoTitleGeneration: true,
  titleGenerationModel: '',

  excludedTags: [],
  mediaFolder: '',
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

  lastCustomModel: '',

  maxTabs: 3,
  tabBarPosition: 'input',
  enableAutoScroll: true,
  deferMathRenderingDuringStreaming: true,
  chatViewPlacement: 'right-sidebar',

  hiddenSlashCommands: getDefaultHiddenSlashCommands(),
};

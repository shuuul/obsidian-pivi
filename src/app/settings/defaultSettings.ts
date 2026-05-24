import { getDefaultHiddenSlashCommands } from '../../core/agent/commands/hiddenCommands';
import { type ObsiusSettings } from '../../core/types/settings';
import {
  DEFAULT_MODEL_KEY,
  DEFAULT_PI_AGENT_SETTINGS,
} from '../../core/settings/agentDefaults';

export const DEFAULT_OBSIUS_SETTINGS: ObsiusSettings = {
  userName: '',

  permissionMode: 'normal',

  model: DEFAULT_MODEL_KEY,
  thinkingBudget: 'off',
  effortLevel: 'high',
  enableAutoTitleGeneration: true,
  titleGenerationModel: '',

  excludedTags: [],
  mediaFolder: '',
  systemPrompt: '',
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

  agentSettings: { ...DEFAULT_PI_AGENT_SETTINGS },

  lastCustomModel: '',

  maxTabs: 3,
  tabBarPosition: 'input',
  enableAutoScroll: true,
  deferMathRenderingDuringStreaming: true,
  chatViewPlacement: 'right-sidebar',

  hiddenSlashCommands: getDefaultHiddenSlashCommands(),
};

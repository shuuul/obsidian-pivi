import { getDefaultHiddenProviderCommands } from '../../core/providers/commands/hiddenCommands';
import { type ObsiusSettings, type PiAgentSettings } from '../../core/types/settings';
import {
  DEFAULT_PI_PROVIDER_SETTINGS,
  PI_DEFAULT_ENVIRONMENT_VARIABLES,
} from '../../providers/pi/settings';

const DEFAULT_PI_SETTINGS: PiAgentSettings = {
  ...DEFAULT_PI_PROVIDER_SETTINGS,
  environmentVariables: PI_DEFAULT_ENVIRONMENT_VARIABLES,
};

export const DEFAULT_OBSIUS_SETTINGS: ObsiusSettings = {
  userName: '',

  permissionMode: 'normal',

  model: 'anthropic/claude-sonnet-4-20250514',
  thinkingBudget: 'off',
  effortLevel: 'high',
  serviceTier: 'default',
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

  piSettings: { ...DEFAULT_PI_SETTINGS },

  lastCustomModel: '',

  maxTabs: 3,
  tabBarPosition: 'input',
  enableAutoScroll: true,
  deferMathRenderingDuringStreaming: true,
  chatViewPlacement: 'right-sidebar',

  hiddenProviderCommands: getDefaultHiddenProviderCommands(),
};

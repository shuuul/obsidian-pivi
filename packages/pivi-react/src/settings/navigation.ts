import type { TranslationKey } from '../i18n';

export type SettingsPageId =
  | 'general'
  | 'environment'
  | 'models'
  | 'builtInTools'
  | 'webTools'
  | 'mcpServers'
  | 'skills'
  | 'prompt'
  | 'commands'
  | 'toolbar';

export interface SettingsPageDescriptor {
  readonly id: SettingsPageId;
  readonly labelKey: TranslationKey;
  readonly descriptionKey: TranslationKey;
  readonly aliasKeys: readonly TranslationKey[];
}

export const SETTINGS_PAGES: Readonly<Record<SettingsPageId, SettingsPageDescriptor>> = {
  general: {
    id: 'general',
    labelKey: 'settings.pages.general.label',
    descriptionKey: 'settings.pages.general.description',
    aliasKeys: [
      'settings.about.heading',
      'settings.about.github',
      'settings.about.issues',
      'settings.language.name',
      'settings.layout',
      'settings.chatViewPlacement.name',
      'settings.tabBarPosition.name',
      'settings.chatBehavior',
      'settings.enableAutoScroll.name',
      'settings.showCacheHitRate.name',
      'settings.showTokensPerSecond.name',
      'settings.deferMathRenderingDuringStreaming.name',
      'settings.autoTitle.name',
      'settings.providerRequests.title',
      'settings.providerRequests.total.name',
      'settings.providerRequests.idle.name',
      'settings.personalizationContext',
      'settings.userName.name',
      'settings.excludedTags.name',
      'settings.inputShortcuts',
      'settings.requireCommandOrControlEnterToSend.name',
      'settings.navMappings.name',
      'settings.sessionFiles.heading',
      'settings.sessionFiles.retention.name',
      'settings.sessionFiles.deleteRemoved.name',
      'settings.styleSettings.name',
    ],
  },
  environment: {
    id: 'environment',
    labelKey: 'settings.pages.environment.label',
    descriptionKey: 'settings.pages.environment.description',
    aliasKeys: [
      'settings.environment',
      'settings.sharedEnvironment.name',
    ],
  },
  models: {
    id: 'models',
    labelKey: 'settings.pages.models.label',
    descriptionKey: 'settings.pages.models.description',
    aliasKeys: [
      'settings.modelsTab.addProvider',
      'settings.modelsTab.candidateModels',
      'settings.modelsTab.contextWindowOverridePlaceholder',
      'settings.modelsTab.reasoningOverrideDesc',
      'settings.modelsTab.thinkingFormatOverrideDesc',
      'settings.modelsTab.endpointHeading',
      'settings.modelsTab.displayName',
      'settings.modelsTab.baseUrl',
      'settings.modelsTab.modelIds',
      'settings.modelsTab.apiKey',
      'settings.modelsTab.oauthToken',
      'settings.modelsTab.authHeading',
      'settings.modelsTab.testProvider',
    ],
  },
  builtInTools: {
    id: 'builtInTools',
    labelKey: 'settings.pages.builtInTools.label',
    descriptionKey: 'settings.pages.builtInTools.description',
    aliasKeys: [
      'settings.tools.sections.builtIn',
      'settings.externalRead.heading',
      'settings.externalRead.allow.name',
      'settings.externalRead.directories.name',
      'settings.bash.heading',
      'settings.bash.allowlist.name',
      'settings.tools.reading.defaultSize.name',
      'settings.tools.heading',
      'settings.subagents.heading',
      'settings.subagents.enableSpawn.name',
      'settings.subagents.allowBackground.name',
      'settings.subagents.maxConcurrent.name',
    ],
  },
  webTools: {
    id: 'webTools',
    labelKey: 'settings.pages.webTools.label',
    descriptionKey: 'settings.pages.webTools.description',
    aliasKeys: [
      'settings.tools.sections.web',
      'settings.webSearch.intro',
      'settings.webSearch.capability.search',
      'settings.webSearch.capability.fetch',
      'settings.webSearch.providers.brave',
      'settings.webSearch.providers.tavily',
      'settings.webSearch.providers.exa',
      'settings.webSearch.providers.anysearch',
    ],
  },
  mcpServers: {
    id: 'mcpServers',
    labelKey: 'settings.pages.mcpServers.label',
    descriptionKey: 'settings.pages.mcpServers.description',
    aliasKeys: [
      'settings.tools.sections.mcp',
      'settings.mcp.modal.serverName',
      'settings.mcp.modal.type',
      'settings.mcp.modal.command',
      'settings.mcp.modal.url',
      'settings.mcp.modal.env',
      'settings.mcp.modal.headersName',
      'settings.mcp.modal.authHeading',
    ],
  },
  skills: {
    id: 'skills',
    labelKey: 'settings.pages.skills.label',
    descriptionKey: 'settings.pages.skills.description',
    aliasKeys: [
      'settings.skills.defaultBundle.name',
      'settings.skills.remote.heading',
      'settings.skills.remote.name',
      'settings.skills.installed.heading',
    ],
  },
  prompt: {
    id: 'prompt',
    labelKey: 'settings.pages.prompt.label',
    descriptionKey: 'settings.pages.prompt.description',
    aliasKeys: [
      'settings.prompt.workflow.heading',
      'settings.prompt.custom.heading',
      'settings.prompt.usage.heading',
    ],
  },
  commands: {
    id: 'commands',
    labelKey: 'settings.pages.commands.label',
    descriptionKey: 'settings.pages.commands.description',
    aliasKeys: [
      'settings.slashCommandsUi.internalHeading',
      'settings.slashCommandsUi.heading',
      'settings.createCommand.name.name',
      'settings.createCommand.description.name',
      'settings.createCommand.argumentHint.name',
      'settings.createCommand.icon.name',
      'settings.createCommand.template.name',
    ],
  },
  toolbar: {
    id: 'toolbar',
    labelKey: 'settings.pages.toolbar.label',
    descriptionKey: 'settings.pages.toolbar.description',
    aliasKeys: [
      'settings.editorToolbar.provider.title',
      'settings.editorToolbar.provider.name',
      'settings.editorToolbar.title',
      'settings.editorToolbar.addEditorCommand',
      'settings.editorToolbar.addPiviCommand',
      'settings.noteToolbar.heading',
    ],
  },
};

export type SettingsRootPageEntry = { kind: 'page'; page: SettingsPageId };
export type SettingsRootContentEntry = { kind: 'content'; page: 'general' };
export type SettingsRootEntry =
  | SettingsRootPageEntry
  | SettingsRootContentEntry
  | {
    kind: 'group';
    labelKey: TranslationKey;
    items: readonly SettingsRootPageEntry[];
  };

export const SETTINGS_ROOT_LAYOUT: readonly SettingsRootEntry[] = [
  { kind: 'content', page: 'general' },
  { kind: 'page', page: 'models' },
  {
    kind: 'group',
    labelKey: 'settings.groups.agent',
    items: [
      { kind: 'page', page: 'builtInTools' },
      { kind: 'page', page: 'webTools' },
      { kind: 'page', page: 'mcpServers' },
      { kind: 'page', page: 'skills' },
      { kind: 'page', page: 'prompt' },
    ],
  },
  {
    kind: 'group',
    labelKey: 'settings.groups.editor',
    items: [
      { kind: 'page', page: 'commands' },
      { kind: 'page', page: 'toolbar' },
    ],
  },
  { kind: 'page', page: 'environment' },
];

import type { TranslationKey } from '../../i18n';

const CODEX_OAUTH_SETTINGS_KEYS = {
  name: 'settings.modelsTab.codex.name',
  desc: 'settings.modelsTab.codex.desc',
  connect: 'settings.modelsTab.codex.connect',
  reconnect: 'settings.modelsTab.codex.reconnect',
  disconnect: 'settings.modelsTab.codex.disconnect',
  connected: 'settings.modelsTab.codex.connected',
  disconnected: 'settings.modelsTab.codex.disconnected',
  loginFailed: 'settings.modelsTab.codex.loginFailed',
} as const satisfies Record<string, TranslationKey>;

const GROK_BUILD_OAUTH_SETTINGS_KEYS = {
  name: 'settings.modelsTab.grokBuild.name',
  desc: 'settings.modelsTab.grokBuild.desc',
  connect: 'settings.modelsTab.grokBuild.connect',
  reconnect: 'settings.modelsTab.grokBuild.reconnect',
  disconnect: 'settings.modelsTab.grokBuild.disconnect',
  connected: 'settings.modelsTab.grokBuild.connected',
  disconnected: 'settings.modelsTab.grokBuild.disconnected',
  loginFailed: 'settings.modelsTab.grokBuild.loginFailed',
} as const satisfies Record<string, TranslationKey>;

const CLAUDE_OAUTH_SETTINGS_KEYS = {
  name: 'settings.modelsTab.claude.name',
  desc: 'settings.modelsTab.claude.desc',
  connect: 'settings.modelsTab.claude.connect',
  reconnect: 'settings.modelsTab.claude.reconnect',
  disconnect: 'settings.modelsTab.claude.disconnect',
  connected: 'settings.modelsTab.claude.connected',
  disconnected: 'settings.modelsTab.claude.disconnected',
  loginFailed: 'settings.modelsTab.claude.loginFailed',
} as const satisfies Record<string, TranslationKey>;

const CHATGPT_OAUTH_SETTINGS_KEYS = {
  name: 'settings.modelsTab.chatgpt.name',
  desc: 'settings.modelsTab.chatgpt.desc',
  connect: 'settings.modelsTab.chatgpt.connect',
  reconnect: 'settings.modelsTab.chatgpt.reconnect',
  disconnect: 'settings.modelsTab.chatgpt.disconnect',
  connected: 'settings.modelsTab.chatgpt.connected',
  disconnected: 'settings.modelsTab.chatgpt.disconnected',
  loginFailed: 'settings.modelsTab.chatgpt.loginFailed',
} as const satisfies Record<string, TranslationKey>;

const OPENROUTER_OAUTH_SETTINGS_KEYS = {
  name: 'settings.modelsTab.openrouter.name',
  desc: 'settings.modelsTab.openrouter.desc',
  connect: 'settings.modelsTab.openrouter.connect',
  reconnect: 'settings.modelsTab.openrouter.reconnect',
  disconnect: 'settings.modelsTab.openrouter.disconnect',
  connected: 'settings.modelsTab.openrouter.connected',
  disconnected: 'settings.modelsTab.openrouter.disconnected',
  loginFailed: 'settings.modelsTab.openrouter.loginFailed',
} as const satisfies Record<string, TranslationKey>;

const KIMI_CODING_OAUTH_SETTINGS_KEYS = {
  name: 'settings.modelsTab.kimiCoding.name',
  desc: 'settings.modelsTab.kimiCoding.desc',
  connect: 'settings.modelsTab.kimiCoding.connect',
  reconnect: 'settings.modelsTab.kimiCoding.reconnect',
  disconnect: 'settings.modelsTab.kimiCoding.disconnect',
  connected: 'settings.modelsTab.kimiCoding.connected',
  disconnected: 'settings.modelsTab.kimiCoding.disconnected',
  loginFailed: 'settings.modelsTab.kimiCoding.loginFailed',
} as const satisfies Record<string, TranslationKey>;

export const OAUTH_COMMON_SETTINGS_KEYS = {
  cancel: 'settings.modelsTab.oauthCommon.cancel',
  deviceCode: 'settings.modelsTab.oauthCommon.deviceCode',
  cancelled: 'settings.modelsTab.oauthCommon.cancelled',
} as const satisfies Record<string, TranslationKey>;

const PROVIDER_OAUTH_SETTINGS_KEYS = {
  'openai-codex': CODEX_OAUTH_SETTINGS_KEYS,
  'grok-build': GROK_BUILD_OAUTH_SETTINGS_KEYS,
  claude: CLAUDE_OAUTH_SETTINGS_KEYS,
  chatgpt: CHATGPT_OAUTH_SETTINGS_KEYS,
  openrouter: OPENROUTER_OAUTH_SETTINGS_KEYS,
  'kimi-coding': KIMI_CODING_OAUTH_SETTINGS_KEYS,
} as const;

export function getProviderOAuthSettingsKeys(providerId: string) {
  const keys = PROVIDER_OAUTH_SETTINGS_KEYS[providerId as keyof typeof PROVIDER_OAUTH_SETTINGS_KEYS];
  if (!keys) {
    throw new Error(`Unsupported interactive OAuth provider: ${providerId}`);
  }
  return keys;
}

import type { TranslationKey } from '../../i18n';

export const CODEX_OAUTH_SETTINGS_KEYS = {
  name: 'settings.modelsTab.codex.name',
  desc: 'settings.modelsTab.codex.desc',
  connect: 'settings.modelsTab.codex.connect',
  reconnect: 'settings.modelsTab.codex.reconnect',
  disconnect: 'settings.modelsTab.codex.disconnect',
  connected: 'settings.modelsTab.codex.connected',
  disconnected: 'settings.modelsTab.codex.disconnected',
  loginFailed: 'settings.modelsTab.codex.loginFailed',
} as const satisfies Record<string, TranslationKey>;

export const XAI_OAUTH_SETTINGS_KEYS = {
  name: 'settings.modelsTab.xai.name',
  desc: 'settings.modelsTab.xai.desc',
  connect: 'settings.modelsTab.xai.connect',
  reconnect: 'settings.modelsTab.xai.reconnect',
  disconnect: 'settings.modelsTab.xai.disconnect',
  connected: 'settings.modelsTab.xai.connected',
  disconnected: 'settings.modelsTab.xai.disconnected',
  loginFailed: 'settings.modelsTab.xai.loginFailed',
} as const satisfies Record<string, TranslationKey>;

export const ANTHROPIC_OAUTH_SETTINGS_KEYS = {
  name: 'settings.modelsTab.anthropic.name',
  desc: 'settings.modelsTab.anthropic.desc',
  connect: 'settings.modelsTab.anthropic.connect',
  reconnect: 'settings.modelsTab.anthropic.reconnect',
  disconnect: 'settings.modelsTab.anthropic.disconnect',
  connected: 'settings.modelsTab.anthropic.connected',
  disconnected: 'settings.modelsTab.anthropic.disconnected',
  loginFailed: 'settings.modelsTab.anthropic.loginFailed',
} as const satisfies Record<string, TranslationKey>;

const PROVIDER_OAUTH_SETTINGS_KEYS = {
  'openai-codex': CODEX_OAUTH_SETTINGS_KEYS,
  xai: XAI_OAUTH_SETTINGS_KEYS,
  anthropic: ANTHROPIC_OAUTH_SETTINGS_KEYS,
} as const;

export function getProviderOAuthSettingsKeys(providerId: string) {
  const keys = PROVIDER_OAUTH_SETTINGS_KEYS[providerId as keyof typeof PROVIDER_OAUTH_SETTINGS_KEYS];
  if (!keys) {
    throw new Error(`Unsupported interactive OAuth provider: ${providerId}`);
  }
  return keys;
}

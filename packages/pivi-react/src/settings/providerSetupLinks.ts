export type ProviderSetupKind = 'api-key' | 'download' | 'docs';

export interface ProviderSetupLink {
  readonly href: string;
  readonly kind: ProviderSetupKind;
}

/** Console or download page for a built-in model provider id or local kind. */
export const MODEL_PROVIDER_SETUP_LINKS: Readonly<Record<string, ProviderSetupLink>> = {
  openai: { href: 'https://platform.openai.com/api-keys', kind: 'api-key' },
  anthropic: { href: 'https://console.anthropic.com/settings/keys', kind: 'api-key' },
  google: { href: 'https://aistudio.google.com/apikey', kind: 'api-key' },
  deepseek: { href: 'https://platform.deepseek.com/api_keys', kind: 'api-key' },
  xai: { href: 'https://console.x.ai/', kind: 'api-key' },
  openrouter: { href: 'https://openrouter.ai/keys', kind: 'api-key' },
  moonshotai: { href: 'https://platform.moonshot.ai/console/api-keys', kind: 'api-key' },
  'moonshotai-cn': { href: 'https://platform.moonshot.cn/console/api-keys', kind: 'api-key' },
  minimax: { href: 'https://www.minimax.io/platform/user-center/basic-information/interface-key', kind: 'api-key' },
  'minimax-cn': { href: 'https://platform.minimaxi.com/user-center/basic-information/interface-key', kind: 'api-key' },
  opencode: { href: 'https://opencode.ai', kind: 'api-key' },
  'opencode-go': { href: 'https://opencode.ai', kind: 'api-key' },
  xiaomi: { href: 'https://platform.xiaomimimo.com/', kind: 'api-key' },
  'xiaomi-token-plan-cn': { href: 'https://platform.xiaomimimo.com/', kind: 'api-key' },
  zai: { href: 'https://open.bigmodel.cn/usercenter/apikeys', kind: 'api-key' },
  'zai-coding-cn': { href: 'https://open.bigmodel.cn/usercenter/apikeys', kind: 'api-key' },
  ollama: { href: 'https://ollama.com/download', kind: 'download' },
  lmstudio: { href: 'https://lmstudio.ai/download', kind: 'download' },
  'llama-cpp': { href: 'https://github.com/ggml-org/llama.cpp', kind: 'download' },
};

/** Console or product page for a web-search provider id. */
export const WEB_PROVIDER_SETUP_LINKS: Readonly<Record<string, ProviderSetupLink>> = {
  brave: { href: 'https://brave.com/search/api/', kind: 'api-key' },
  tavily: { href: 'https://app.tavily.com/home', kind: 'api-key' },
  exa: { href: 'https://dashboard.exa.ai/api-keys', kind: 'api-key' },
  anysearch: { href: 'https://anysearch.com/console/api-keys', kind: 'api-key' },
};

export function getModelProviderSetupLink(providerId: string): ProviderSetupLink | undefined {
  return MODEL_PROVIDER_SETUP_LINKS[providerId];
}

export function getWebProviderSetupLink(providerId: string): ProviderSetupLink | undefined {
  return WEB_PROVIDER_SETUP_LINKS[providerId];
}

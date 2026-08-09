import { getProviderEnvVarNames } from './providerEnvVars';

const CODEX_PROVIDER_ID = 'openai-codex';

export function getProviderAuthFailureHint(providerId: string): string {
  if (providerId === CODEX_PROVIDER_ID) {
    return 'Provider: openai-codex. Reconnect OpenAI Codex OAuth in provider settings.';
  }

  return `Provider: ${providerId}. Expected env var: ${getProviderEnvVarNames(providerId).apiKeyVar}`;
}

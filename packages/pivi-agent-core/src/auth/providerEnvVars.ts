/** Environment variable names for a pi-ai provider's credentials. */
export interface ProviderEnvVarNames {
  apiKeyVar: string;
  oauthVar?: string;
}

export function getProviderEnvVarNames(providerId: string): ProviderEnvVarNames {
  if (providerId === 'anthropic') {
    return { apiKeyVar: 'ANTHROPIC_API_KEY', oauthVar: 'ANTHROPIC_OAUTH_TOKEN' };
  }
  if (providerId === 'google' || providerId === 'gemini') {
    return { apiKeyVar: 'GEMINI_API_KEY' };
  }
  if (providerId === 'kimi-coding') {
    return { apiKeyVar: 'KIMI_API_KEY' };
  }
  if (providerId === 'moonshotai' || providerId === 'moonshotai-cn') {
    return { apiKeyVar: 'MOONSHOT_API_KEY' };
  }
  if (providerId === 'github-copilot') {
    return { apiKeyVar: 'COPILOT_GITHUB_TOKEN' };
  }
  if (providerId === 'google-vertex') {
    return { apiKeyVar: 'GOOGLE_CLOUD_API_KEY' };
  }
  if (providerId === 'huggingface') {
    return { apiKeyVar: 'HF_TOKEN' };
  }
  if (providerId === 'opencode-go') {
    return { apiKeyVar: 'OPENCODE_API_KEY' };
  }

  const prefix = providerId.replace(/-/g, '_').toUpperCase();
  return { apiKeyVar: `${prefix}_API_KEY` };
}

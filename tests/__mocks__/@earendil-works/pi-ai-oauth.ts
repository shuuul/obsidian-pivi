export const CODEX_OAUTH_PROVIDER_ID = 'openai-codex';

export async function loginOpenAICodex(): Promise<{ access: string; refresh: string; expires: number }> {
  return { access: 'mock', refresh: 'mock', expires: Date.now() + 3600_000 };
}

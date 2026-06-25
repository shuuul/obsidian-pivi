export const CODEX_OAUTH_PROVIDER_ID = 'openai-codex';
export const OPENAI_CODEX_BROWSER_LOGIN_METHOD = 'browser';
export const OPENAI_CODEX_DEVICE_CODE_LOGIN_METHOD = 'device_code';

export async function loginOpenAICodex(): Promise<{ access: string; refresh: string; expires: number }> {
  return { access: 'mock', refresh: 'mock', expires: Date.now() + 3600_000 };
}

export const openaiCodexOAuthProvider = {
  id: CODEX_OAUTH_PROVIDER_ID,
  name: 'ChatGPT Plus/Pro (Codex Subscription)',
  usesCallbackServer: true,
  login: async (callbacks: {
    onAuth: (info: { url: string; instructions?: string }) => void;
    onDeviceCode: (info: { userCode: string; verificationUri: string }) => void;
    onSelect: (prompt: { message: string; options: { id: string; label: string }[] }) => Promise<string | undefined>;
  }) => {
    const method = await callbacks.onSelect({
      message: 'Select OpenAI Codex login method:',
      options: [
        { id: OPENAI_CODEX_BROWSER_LOGIN_METHOD, label: 'Browser login (default)' },
        { id: OPENAI_CODEX_DEVICE_CODE_LOGIN_METHOD, label: 'Device code login (headless)' },
      ],
    });
    if (method === OPENAI_CODEX_DEVICE_CODE_LOGIN_METHOD) {
      callbacks.onDeviceCode({ userCode: 'ABCD-EFGH', verificationUri: 'https://auth.openai.com/codex/device' });
      return { access: 'mock-access', refresh: 'mock-refresh', expires: Date.now() + 3600_000 };
    }
    if (method !== OPENAI_CODEX_BROWSER_LOGIN_METHOD) {
      throw new Error(`Unknown OpenAI Codex login method: ${String(method)}`);
    }
    callbacks.onAuth({ url: 'https://auth.openai.com/oauth/authorize' });
    return { access: 'mock-access', refresh: 'mock-refresh', expires: Date.now() + 3600_000 };
  },
  refreshToken: async () => ({ access: 'mock-access', refresh: 'mock-refresh', expires: Date.now() + 3600_000 }),
  getApiKey: (credentials: { access: string }) => credentials.access,
};

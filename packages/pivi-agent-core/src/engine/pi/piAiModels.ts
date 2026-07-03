import {
  type AuthContext,
  type AuthLoginCallbacks,
  createModels,
  type CredentialStore,
  type MutableModels,
  type OAuthCredential,
  type Provider,
} from '@earendil-works/pi-ai';
import {
  OPENAI_CODEX_BROWSER_LOGIN_METHOD,
  openaiCodexOAuthProvider,
} from '@earendil-works/pi-ai/oauth';
import { anthropicProvider } from '@earendil-works/pi-ai/providers/anthropic';
import { deepseekProvider } from '@earendil-works/pi-ai/providers/deepseek';
import { googleProvider } from '@earendil-works/pi-ai/providers/google';
import { openaiCodexProvider } from '@earendil-works/pi-ai/providers/openai-codex';
import { opencodeGoProvider } from '@earendil-works/pi-ai/providers/opencode-go';
import { openrouterProvider } from '@earendil-works/pi-ai/providers/openrouter';

/** Shared pi-ai Models collection for the Pi engine adapter. */
export let piAiModels: MutableModels = createModels();

function createOpenAICodexProvider(): Provider {
  const provider = openaiCodexProvider();
  return {
    ...provider,
    auth: {
      ...provider.auth,
      oauth: {
        name: 'OpenAI (ChatGPT Plus/Pro)',
        async login(callbacks: AuthLoginCallbacks): Promise<OAuthCredential> {
          const credential = await openaiCodexOAuthProvider.login({
            onAuth: (info) => callbacks.notify({ type: 'auth_url', url: info.url, instructions: info.instructions }),
            onDeviceCode: (info) => callbacks.notify({ type: 'device_code', ...info }),
            onProgress: (message) => callbacks.notify({ type: 'progress', message }),
            onPrompt: (prompt) => callbacks.prompt({ type: 'text', message: prompt.message, placeholder: prompt.placeholder }),
            onManualCodeInput: () => callbacks.prompt({
              type: 'manual_code',
              message: 'Complete login in your browser, or paste the authorization code / redirect URL here:',
              signal: callbacks.signal,
            }),
            onSelect: () => Promise.resolve(OPENAI_CODEX_BROWSER_LOGIN_METHOD),
            signal: callbacks.signal,
          });
          return { ...credential, type: 'oauth' };
        },
        async refresh(credential: OAuthCredential): Promise<OAuthCredential> {
          return { ...(await openaiCodexOAuthProvider.refreshToken(credential)), type: 'oauth' };
        },
        toAuth(credential: OAuthCredential) {
          return Promise.resolve({ apiKey: openaiCodexOAuthProvider.getApiKey(credential) });
        },
      },
    },
  };
}

function installSupportedProviders(models: MutableModels): void {
  models.setProvider(anthropicProvider());
  models.setProvider(deepseekProvider());
  models.setProvider(googleProvider());
  models.setProvider(createOpenAICodexProvider());
  models.setProvider(opencodeGoProvider());
  models.setProvider(openrouterProvider());
}

installSupportedProviders(piAiModels);

export function configurePiAiModels(options: {
  credentials?: CredentialStore;
  authContext?: AuthContext;
}): void {
  piAiModels = createModels(options);
  installSupportedProviders(piAiModels);
}

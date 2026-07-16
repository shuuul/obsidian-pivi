import type { AuthInteraction, AuthPrompt } from '@earendil-works/pi-ai';

import {
  PROVIDER_OAUTH_LOGIN_CANCELLED,
  type ProviderOAuthProgress,
} from '../../auth/providerOAuthProgress';
import { PluginLogger } from '../../foundation/pluginLogger';
import type { OAuthFlowHost } from '../../ports';

const logger = new PluginLogger('PiAuthInteraction');

export const OPENAI_CODEX_BROWSER_LOGIN_METHOD = 'browser';

export interface CreatePiAuthInteractionOptions {
  oauthHost: OAuthFlowHost;
  onProgress?: (progress: ProviderOAuthProgress) => void;
  signal?: AbortSignal;
  /** When set, auth_url opens through Codex-safe URL normalization. */
  normalizeAuthUrl?: (url: string) => string;
}

function emitProgress(
  onProgress: ((progress: ProviderOAuthProgress) => void) | undefined,
  progress: ProviderOAuthProgress,
): void {
  onProgress?.(progress);
}

function notifyMessage(
  oauthHost: OAuthFlowHost,
  onProgress: ((progress: ProviderOAuthProgress) => void) | undefined,
  message: string,
): void {
  emitProgress(onProgress, { kind: 'message', message });
  oauthHost.notify?.(message);
}

function openAuthUrl(
  oauthHost: OAuthFlowHost,
  url: string,
  context: string,
): void {
  void oauthHost.openAuthUrl(url).catch((error: unknown) => {
    logger.warn(`failed to open OAuth URL (${context})`, error);
  });
}

function toAbortError(reason: unknown): Error {
  return reason instanceof Error ? reason : new Error(PROVIDER_OAUTH_LOGIN_CANCELLED);
}

function waitForManualCodeAbort(...signals: Array<AbortSignal | undefined>): Promise<string> {
  return new Promise((_, reject) => {
    const activeSignals = signals.filter((candidate): candidate is AbortSignal => !!candidate);
    const cleanup = (): void => {
      for (const activeSignal of activeSignals) {
        activeSignal.removeEventListener('abort', onAbort);
      }
    };
    const onAbort = (event: Event): void => {
      cleanup();
      const abortedSignal = event.currentTarget as AbortSignal;
      reject(toAbortError(abortedSignal.reason));
    };
    const alreadyAborted = activeSignals.find(activeSignal => activeSignal.aborted);
    if (alreadyAborted) {
      reject(toAbortError(alreadyAborted.reason));
      return;
    }
    for (const activeSignal of activeSignals) {
      activeSignal.addEventListener('abort', onAbort, { once: true });
    }
  });
}

/** Map pi-ai AuthInteraction onto Pivi's injected OAuth host and progress callbacks. */
export function createPiAuthInteraction(options: CreatePiAuthInteractionOptions): AuthInteraction {
  const { oauthHost, onProgress, signal, normalizeAuthUrl } = options;

  return {
    signal,
    notify(event) {
      switch (event.type) {
        case 'auth_url': {
          notifyMessage(oauthHost, onProgress, 'Opening browser for sign-in…');
          const url = normalizeAuthUrl ? normalizeAuthUrl(event.url) : event.url;
          openAuthUrl(oauthHost, url, 'auth_url');
          if (event.instructions) {
            notifyMessage(oauthHost, onProgress, event.instructions);
          }
          break;
        }
        case 'device_code': {
          if (event.userCode) {
            emitProgress(onProgress, {
              kind: 'device_code',
              userCode: event.userCode,
              verificationUri: event.verificationUri,
            });
          }
          if (event.verificationUri) {
            openAuthUrl(oauthHost, event.verificationUri, 'device_code');
          }
          break;
        }
        case 'progress':
        case 'info':
          notifyMessage(oauthHost, onProgress, event.message);
          break;
        default:
          break;
      }
    },
    async prompt(prompt: AuthPrompt): Promise<string> {
      if (prompt.type === 'select') {
        return OPENAI_CODEX_BROWSER_LOGIN_METHOD;
      }
      if (prompt.type === 'manual_code') {
        notifyMessage(oauthHost, onProgress, prompt.message);
        return waitForManualCodeAbort(prompt.signal, signal);
      }
      if (prompt.type === 'text' || prompt.type === 'secret') {
        notifyMessage(oauthHost, onProgress, prompt.message);
        return Promise.reject(
          new Error('Interactive OAuth login did not complete in the browser. Ensure the localhost callback is reachable, then try again.'),
        );
      }
      return Promise.reject(new Error(`Unsupported OAuth prompt type: ${String((prompt as AuthPrompt).type)}`));
    },
  };
}

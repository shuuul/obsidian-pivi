import type { AuthInteraction, AuthPrompt } from '@earendil-works/pi-ai';

import { PluginLogger } from '../../foundation/pluginLogger';
import type { OAuthFlowHost } from '../../ports';

const logger = new PluginLogger('PiAuthInteraction');

export const OPENAI_CODEX_BROWSER_LOGIN_METHOD = 'browser';

export interface CreatePiAuthInteractionOptions {
  oauthHost: OAuthFlowHost;
  onProgress?: (message: string) => void;
  signal?: AbortSignal;
  /** When set, auth_url opens through Codex-safe URL normalization. */
  normalizeAuthUrl?: (url: string) => string;
}

function notifyProgress(
  oauthHost: OAuthFlowHost,
  onProgress: ((message: string) => void) | undefined,
  message: string,
): void {
  onProgress?.(message);
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
  return reason instanceof Error ? reason : new Error('Login cancelled');
}

function waitForManualCodeAbort(signal: AbortSignal | undefined): Promise<string> {
  return new Promise((_, reject) => {
    if (!signal) {
      return;
    }
    if (signal.aborted) {
      reject(toAbortError(signal.reason));
      return;
    }
    signal.addEventListener('abort', () => {
      reject(toAbortError(signal.reason));
    }, { once: true });
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
          notifyProgress(oauthHost, onProgress, 'Opening browser for sign-in…');
          const url = normalizeAuthUrl ? normalizeAuthUrl(event.url) : event.url;
          openAuthUrl(oauthHost, url, 'auth_url');
          if (event.instructions) {
            notifyProgress(oauthHost, onProgress, event.instructions);
          }
          break;
        }
        case 'device_code': {
          notifyProgress(
            oauthHost,
            onProgress,
            `Open ${event.verificationUri} and enter code ${event.userCode}.`,
          );
          openAuthUrl(oauthHost, event.verificationUri, 'device_code');
          break;
        }
        case 'progress':
        case 'info':
          notifyProgress(oauthHost, onProgress, event.message);
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
        notifyProgress(oauthHost, onProgress, prompt.message);
        return waitForManualCodeAbort(prompt.signal ?? signal);
      }
      if (prompt.type === 'text' || prompt.type === 'secret') {
        notifyProgress(oauthHost, onProgress, prompt.message);
        return Promise.reject(
          new Error('Interactive OAuth login did not complete in the browser. Ensure the localhost callback is reachable, then try again.'),
        );
      }
      return Promise.reject(new Error(`Unsupported OAuth prompt type: ${String((prompt as AuthPrompt).type)}`));
    },
  };
}

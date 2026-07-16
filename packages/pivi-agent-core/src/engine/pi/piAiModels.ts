import {
  type AuthContext,
  createModels,
  type CredentialStore,
  type MutableModels,
} from '@earendil-works/pi-ai';
import { anthropicProvider } from '@earendil-works/pi-ai/providers/anthropic';
import { deepseekProvider } from '@earendil-works/pi-ai/providers/deepseek';
import { googleProvider } from '@earendil-works/pi-ai/providers/google';
import { kimiCodingProvider } from '@earendil-works/pi-ai/providers/kimi-coding';
import { minimaxProvider } from '@earendil-works/pi-ai/providers/minimax';
import { minimaxCnProvider } from '@earendil-works/pi-ai/providers/minimax-cn';
import { moonshotaiProvider } from '@earendil-works/pi-ai/providers/moonshotai';
import { moonshotaiCnProvider } from '@earendil-works/pi-ai/providers/moonshotai-cn';
import { openaiProvider } from '@earendil-works/pi-ai/providers/openai';
import { openaiCodexProvider } from '@earendil-works/pi-ai/providers/openai-codex';
import { opencodeProvider } from '@earendil-works/pi-ai/providers/opencode';
import { opencodeGoProvider } from '@earendil-works/pi-ai/providers/opencode-go';
import { openrouterProvider } from '@earendil-works/pi-ai/providers/openrouter';
import { xaiProvider } from '@earendil-works/pi-ai/providers/xai';
import { xiaomiProvider } from '@earendil-works/pi-ai/providers/xiaomi';
import { xiaomiTokenPlanCnProvider } from '@earendil-works/pi-ai/providers/xiaomi-token-plan-cn';
import { zaiProvider } from '@earendil-works/pi-ai/providers/zai';
import { zaiCodingCnProvider } from '@earendil-works/pi-ai/providers/zai-coding-cn';

import type { CustomProviderConfig } from '../../foundation/customProviders';
import { PluginLogger } from '../../foundation/pluginLogger';
import {
  buildCustomPiProvider,
  type CustomProviderHttpGet,
  installCustomProviders,
} from './installPiCustomProviders';
import { cachePiAiRegistryModels } from './piModelRegistry';

const logger = new PluginLogger('PiAiModels');

/** Shared pi-ai Models collection for the Pi engine adapter. */
export let piAiModels: MutableModels = createModels();

const customProviderRuntime = {
  installedProviderIds: [] as string[],
  installedConfigs: new Map<string, CustomProviderConfig>(),
  httpGet: undefined as CustomProviderHttpGet | undefined,
  getApiKey: undefined as ((providerId: string) => string | undefined) | undefined,
  reset(options?: {
    httpGet?: CustomProviderHttpGet;
    getApiKey?: (providerId: string) => string | undefined;
  }): void {
    this.installedProviderIds = [];
    this.installedConfigs = new Map();
    this.httpGet = options?.httpGet;
    this.getApiKey = options?.getApiKey;
  },
};

function installSupportedProviders(models: MutableModels): void {
  models.setProvider(anthropicProvider());
  models.setProvider(deepseekProvider());
  models.setProvider(googleProvider());
  models.setProvider(kimiCodingProvider());
  models.setProvider(minimaxProvider());
  models.setProvider(minimaxCnProvider());
  models.setProvider(moonshotaiProvider());
  models.setProvider(moonshotaiCnProvider());
  models.setProvider(openaiProvider());
  models.setProvider(openaiCodexProvider());
  models.setProvider(opencodeProvider());
  models.setProvider(opencodeGoProvider());
  models.setProvider(openrouterProvider());
  models.setProvider(xaiProvider());
  models.setProvider(xiaomiProvider());
  models.setProvider(xiaomiTokenPlanCnProvider());
  models.setProvider(zaiProvider());
  models.setProvider(zaiCodingCnProvider());
}

installSupportedProviders(piAiModels);

export function configurePiAiModels(options: {
  credentials?: CredentialStore;
  authContext?: AuthContext;
  customProviders?: readonly CustomProviderConfig[];
  httpGet?: CustomProviderHttpGet;
  getApiKey?: (providerId: string) => string | undefined;
}): void {
  customProviderRuntime.reset(options);
  piAiModels = createModels({
    credentials: options.credentials,
    authContext: options.authContext,
  });
  installSupportedProviders(piAiModels);
  if (options.customProviders) {
    syncCustomPiProviders(options.customProviders);
  } else {
    cachePiAiRegistryModels(piAiModels);
  }
}

/** Install or replace custom/local providers without recreating built-ins. */
export function syncCustomPiProviders(
  customProviders: readonly CustomProviderConfig[],
): void {
  installCustomProviders(piAiModels, customProviders, {
    httpGet: customProviderRuntime.httpGet,
    getApiKey: customProviderRuntime.getApiKey,
    previousCustomIds: customProviderRuntime.installedProviderIds,
  });
  customProviderRuntime.installedProviderIds = customProviders.map((provider) => provider.id);
  customProviderRuntime.installedConfigs = new Map(customProviders.map((config) => [config.id, config]));
  try {
    cachePiAiRegistryModels(piAiModels);
  } catch (err) {
    logger.error('Failed to refresh pi-ai models cache after custom providers', err);
  }
}

export function getInstalledCustomProviderIds(): readonly string[] {
  return customProviderRuntime.installedProviderIds;
}

/** Refresh a custom provider's runtime model metadata after it has been used. */
export async function refreshCustomPiProviderModels(providerId: string): Promise<boolean> {
  const provider = piAiModels.getProvider(providerId);
  if (!provider?.refreshModels) {
    return false;
  }
  const store = {
    read: async () => undefined,
    write: async () => {},
    delete: async () => {},
  };
  await provider.refreshModels({
    store,
    allowNetwork: true,
    force: true,
  });
  const config = customProviderRuntime.installedConfigs.get(providerId);
  if (config && customProviderRuntime.httpGet) {
    piAiModels.setProvider(
      buildCustomPiProvider(config, {
        httpGet: customProviderRuntime.httpGet,
        getApiKey: customProviderRuntime.getApiKey
          ? () => customProviderRuntime.getApiKey?.(providerId)
          : undefined,
      }),
    );
  }
  cachePiAiRegistryModels(piAiModels);
  return true;
}

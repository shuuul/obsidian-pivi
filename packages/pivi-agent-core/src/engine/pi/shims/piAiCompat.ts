import {
  type Api,
  type AssistantMessage,
  type AssistantMessageEventStream,
  clampThinkingLevel,
  type Context,
  EventStream,
  type Model,
  type ProviderStreams,
  type SimpleStreamOptions,
  validateToolArguments,
} from '@earendil-works/pi-ai';

import { piAiModels } from '../piAiModels';
import { findEnvKeys, getEnvApiKey } from './piAiEnvApiKeys';

type ApiProvider = {
  api: Api;
  stream: ProviderStreams['stream'];
  streamSimple: ProviderStreams['streamSimple'];
};

type ApiProviderRegistryEntry = {
  provider: ApiProvider;
  sourceId?: string;
};

const apiProviderRegistry = new Map<Api, ApiProviderRegistryEntry>();

function withEnvApiKey(options: SimpleStreamOptions | undefined, provider: string): SimpleStreamOptions | undefined {
  const explicitApiKey = typeof options?.apiKey === 'string' && options.apiKey.trim().length > 0;
  if (explicitApiKey) return options;

  const apiKey = getEnvApiKey(provider);
  return apiKey ? { ...options, apiKey } : options;
}

function resolveRegisteredApiProvider(api: Api): ApiProvider | undefined {
  return apiProviderRegistry.get(api)?.provider;
}

export function streamSimple(
  model: Model<Api>,
  context: Context,
  options?: SimpleStreamOptions,
): AssistantMessageEventStream {
  const registeredProvider = resolveRegisteredApiProvider(model.api);
  if (registeredProvider) {
    return registeredProvider.streamSimple(model, context, withEnvApiKey(options, model.provider));
  }

  return piAiModels.streamSimple(model, context, withEnvApiKey(options, model.provider));
}

export async function completeSimple(
  model: Model<Api>,
  context: Context,
  options?: SimpleStreamOptions,
): Promise<AssistantMessage> {
  return streamSimple(model, context, options).result();
}

export function stream(
  model: Model<Api>,
  context: Context,
  options?: SimpleStreamOptions,
): AssistantMessageEventStream {
  const registeredProvider = resolveRegisteredApiProvider(model.api);
  if (registeredProvider) {
    return registeredProvider.stream(model, context, withEnvApiKey(options, model.provider));
  }

  return piAiModels.stream(model, context, withEnvApiKey(options, model.provider));
}

export async function complete(
  model: Model<Api>,
  context: Context,
  options?: SimpleStreamOptions,
): Promise<AssistantMessage> {
  return stream(model, context, options).result();
}

export function getProviders(): string[] {
  return piAiModels.getProviders().map((provider) => provider.id);
}

export function getModels(provider?: string): readonly Model<Api>[] {
  return piAiModels.getModels(provider);
}

export function getModel(provider: string, id: string): Model<Api> | undefined {
  return piAiModels.getModel(provider, id);
}

export function registerApiProvider(provider: ApiProvider, sourceId?: string): void {
  apiProviderRegistry.set(provider.api, { provider, sourceId });
}

export function getApiProvider(api: Api): ApiProvider | undefined {
  return apiProviderRegistry.get(api)?.provider;
}

export function getApiProviders(): ApiProvider[] {
  return Array.from(apiProviderRegistry.values(), (entry) => entry.provider);
}

export function unregisterApiProviders(sourceId?: string): void {
  if (!sourceId) {
    apiProviderRegistry.clear();
    return;
  }

  for (const [api, entry] of apiProviderRegistry.entries()) {
    if (entry.sourceId === sourceId) {
      apiProviderRegistry.delete(api);
    }
  }
}

export function resetApiProviders(): void {
  apiProviderRegistry.clear();
}

export { clampThinkingLevel, EventStream, findEnvKeys, getEnvApiKey, validateToolArguments };

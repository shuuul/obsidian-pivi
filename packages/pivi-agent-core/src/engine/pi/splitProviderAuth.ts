import type {
  Api,
  ApiStreamOptions,
  Context,
  Model,
  Provider,
  SimpleStreamOptions,
} from '@earendil-works/pi-ai';

function requireApiKeyAuth<TApi extends Api>(provider: Provider<TApi>) {
  if (!provider.auth.apiKey) {
    throw new Error(`Provider ${provider.id} does not expose API-key authentication.`);
  }
  return provider.auth.apiKey;
}

function requireOAuthAuth<TApi extends Api>(provider: Provider<TApi>) {
  if (!provider.auth.oauth) {
    throw new Error(`Provider ${provider.id} does not expose OAuth authentication.`);
  }
  return provider.auth.oauth;
}

/** Keep a built-in provider's API behavior while excluding its OAuth credential path. */
export function createApiKeyOnlyProvider<TApi extends Api>(provider: Provider<TApi>): Provider<TApi> {
  return {
    ...provider,
    auth: { apiKey: requireApiKeyAuth(provider) },
  };
}

/**
 * Give a subscription plan its own model/provider identity and OAuth credential slot.
 * The API implementation still receives the built-in provider id for provider-specific
 * payload/header behavior.
 */
export function createSubscriptionOAuthProvider<TApi extends Api>(
  provider: Provider<TApi>,
  subscriptionProviderId: string,
  subscriptionProviderName: string,
): Provider<TApi> {
  const toSubscriptionModel = (model: Model<TApi>): Model<TApi> => ({
    ...model,
    provider: subscriptionProviderId,
  });
  const toBackingModel = <T extends TApi>(model: Model<T>): Model<T> => ({
    ...model,
    provider: provider.id,
  });

  return {
    id: subscriptionProviderId,
    name: subscriptionProviderName,
    ...(provider.baseUrl ? { baseUrl: provider.baseUrl } : {}),
    ...(provider.headers ? { headers: provider.headers } : {}),
    auth: { oauth: requireOAuthAuth(provider) },
    getModels: () => provider.getModels().map(toSubscriptionModel),
    stream<T extends TApi>(model: Model<T>, context: Context, options?: ApiStreamOptions<T>) {
      return provider.stream(toBackingModel(model), context, options);
    },
    streamSimple(model: Model<TApi>, context: Context, options?: SimpleStreamOptions) {
      return provider.streamSimple(toBackingModel(model), context, options);
    },
  };
}

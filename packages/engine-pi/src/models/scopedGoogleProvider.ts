import type {
  Api,
  ApiStreamOptions,
  Context,
  Model,
  Provider,
  SimpleStreamOptions,
  StreamOptions,
} from '@earendil-works/pi-ai';
import type { FetchCompatible } from '@pivi/agent/ports';

const GOOGLE_GENERATIVE_AI_API = 'google-generative-ai';

function withoutScopedFetch<T extends StreamOptions>(
  model: Model<Api>,
  options: T | undefined,
  configuredFetch: FetchCompatible | undefined,
): T | undefined {
  if (model.api !== GOOGLE_GENERATIVE_AI_API) {
    return options;
  }
  if (!configuredFetch) {
    throw new Error('Google streaming requires the configured Pivi provider fetch.');
  }
  if (options?.fetch !== configuredFetch) {
    throw new Error('Google streaming received an unexpected provider fetch.');
  }

  // Pi 0.83's Google adapter rejects custom fetches, while @google/genai uses a
  // free `fetch` identifier. The production bundle inject routes that identifier
  // to the same configured Pivi client. Remove only the unsupported option after
  // verifying its identity so the adapter cannot fall back to ambient networking.
  const next = { ...options };
  delete next.fetch;
  return next;
}

/** Preserve the upstream provider catalog/auth while adapting its Google API transport. */
export function withScopedGoogleTransport<TApi extends Api>(
  provider: Provider<TApi>,
  getConfiguredFetch: () => FetchCompatible | undefined,
): Provider<TApi> {
  return {
    ...provider,
    stream<T extends TApi>(model: Model<T>, context: Context, options?: ApiStreamOptions<T>) {
      return provider.stream(
        model,
        context,
        withoutScopedFetch(model, options, getConfiguredFetch()),
      );
    },
    streamSimple(model: Model<TApi>, context: Context, options?: SimpleStreamOptions) {
      return provider.streamSimple(
        model,
        context,
        withoutScopedFetch(model, options, getConfiguredFetch()),
      );
    },
  };
}

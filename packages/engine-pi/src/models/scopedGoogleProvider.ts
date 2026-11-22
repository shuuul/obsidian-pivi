import type {
  Api,
  ApiStreamOptions,
  Model,
  Provider,
  SimpleStreamOptions,
  StreamOptions,
  TranscriptContext,
} from '@earendil-works/pi-ai';
import type { FetchCompatible } from '@pivi/agent/ports';

const GOOGLE_GENERATIVE_AI_API = 'google-generative-ai';

function requireScopedFetch<T extends StreamOptions>(
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

  return options;
}

/** Require the Pivi transport for Google API models, including mixed providers. */
export function withScopedGoogleTransport<TApi extends Api>(
  provider: Provider<TApi>,
  getConfiguredFetch: () => FetchCompatible | undefined,
): Provider<TApi> {
  return {
    ...provider,
    stream<T extends TApi>(model: Model<T>, context: TranscriptContext, options?: ApiStreamOptions<T>) {
      return provider.stream(
        model,
        context,
        requireScopedFetch(model, options, getConfiguredFetch()),
      );
    },
    streamSimple(model: Model<TApi>, context: TranscriptContext, options?: SimpleStreamOptions) {
      return provider.streamSimple(
        model,
        context,
        requireScopedFetch(model, options, getConfiguredFetch()),
      );
    },
  };
}

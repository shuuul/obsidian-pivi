import * as piAi from '@earendil-works/pi-ai';

import { PI_AI_MODELS_CACHE } from '../ui/PiChatUIConfig';

export type PiResolvedModel = NonNullable<ReturnType<typeof piAi.getModel>>;

/** Resolve a `provider/modelId` key via cache or pi-ai registry. */
export function resolvePiModelFromKey(modelKey: string): PiResolvedModel | null {
  const cached = PI_AI_MODELS_CACHE.get(modelKey);
  if (cached) {
    return cached as PiResolvedModel;
  }

  const slashIndex = modelKey.indexOf('/');
  if (slashIndex <= 0) {
    return null;
  }

  try {
    const provider = modelKey.substring(0, slashIndex);
    const modelId = modelKey.substring(slashIndex + 1);
    return (
      piAi.getModel as (p: string, id: string) => PiResolvedModel | undefined
    )(provider, modelId) ?? null;
  } catch {
    return null;
  }
}

import * as piAi from '@earendil-works/pi-ai';

import { PI_AI_MODELS_CACHE, type PiCachedModel } from '../ui/PiChatUIConfig';

/** Model shape from pi-ai registry / warm cache (wider than `getModel` literal provider keys). */
export type PiResolvedModel = PiCachedModel;

/** Resolve a `provider/modelId` key via cache or pi-ai registry. */
export function resolvePiModelFromKey(modelKey: string): PiResolvedModel | null {
  const cached = PI_AI_MODELS_CACHE.get(modelKey);
  if (cached) {
    return cached;
  }

  const slashIndex = modelKey.indexOf('/');
  if (slashIndex <= 0) {
    return null;
  }

  try {
    const provider = modelKey.substring(0, slashIndex);
    const modelId = modelKey.substring(slashIndex + 1);
    const resolved = piAi.getModel(
      provider as Parameters<typeof piAi.getModel>[0],
      modelId as Parameters<typeof piAi.getModel>[1],
    );
    return resolved ?? null;
  } catch {
    return null;
  }
}

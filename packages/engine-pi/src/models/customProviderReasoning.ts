import type { MutableModels, ThinkingLevelMap } from '@earendil-works/pi-ai';
import type {
  defaultModelMeta} from '@pivi/agent/settings/customProviders';
import {
  type CustomProviderModelDef,
  type CustomProviderReasoningEffort
} from '@pivi/agent/settings/customProviders';

const PI_THINKING_LEVELS = [
  'off',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
] as const;

function thinkingLevelMapFromEfforts(
  efforts: readonly CustomProviderReasoningEffort[],
  options?: { mandatory?: boolean },
): ThinkingLevelMap {
  const supported = new Set(efforts);
  const map: ThinkingLevelMap = {};
  for (const level of PI_THINKING_LEVELS) {
    if (level === 'off') {
      map.off = options?.mandatory ? null : 'none';
      continue;
    }
    map[level] = supported.has(level) ? level : null;
  }
  return map;
}

/** Built-in catalog row used to inherit thinking levels onto a matching custom model id. */
export interface KnownModelReasoningSource {
  id: string;
  reasoning?: boolean;
  thinkingLevelMap?: ThinkingLevelMap;
  defaultThinkingLevel?: (typeof PI_THINKING_LEVELS)[number];
}

function modelIdAliases(modelId: string): string[] {
  const trimmed = modelId.trim();
  if (!trimmed) {
    return [];
  }
  const slash = trimmed.lastIndexOf('/');
  const bare = slash >= 0 ? trimmed.slice(slash + 1) : trimmed;
  return bare === trimmed ? [trimmed] : [trimmed, bare];
}

function modelFamilyStem(modelId: string): string | undefined {
  const aliases = modelIdAliases(modelId);
  const bare = aliases.length > 0 ? aliases[aliases.length - 1]! : modelId.trim();
  const match = bare.match(/^[a-z]+[0-9]*/i);
  if (!match) {
    return undefined;
  }
  const stem = match[0].toLowerCase();
  return stem.length >= 5 ? stem : undefined;
}

function pickKnownModelReasoningSource(
  pool: readonly KnownModelReasoningSource[],
): KnownModelReasoningSource | undefined {
  if (pool.length === 0) {
    return undefined;
  }
  const withMap = pool.filter((model) => model.thinkingLevelMap);
  const preferred = withMap.length > 0 ? withMap : pool;
  return preferred.find((model) => model.reasoning) ?? preferred[0];
}

function findKnownModelReasoningSource(
  modelId: string,
  knownModels: readonly KnownModelReasoningSource[],
): KnownModelReasoningSource | undefined {
  const aliases = new Set(modelIdAliases(modelId));
  if (aliases.size === 0) {
    return undefined;
  }

  const candidates = knownModels.filter((model) => (
    modelIdAliases(model.id).some((id) => aliases.has(id))
  ));
  if (candidates.length > 0) {
    const exact = candidates.filter((model) => model.id === modelId);
    return pickKnownModelReasoningSource(exact.length > 0 ? exact : candidates);
  }

  const stem = modelFamilyStem(modelId);
  if (!stem) {
    return undefined;
  }
  const family = knownModels.filter((model) => modelFamilyStem(model.id) === stem);
  return pickKnownModelReasoningSource(family);
}

export function collectKnownModelReasoningSources(
  registry: MutableModels,
  excludeProviderIds: ReadonlySet<string>,
): KnownModelReasoningSource[] {
  return registry.getModels().flatMap((model) => {
    if (excludeProviderIds.has(model.provider)) {
      return [];
    }
    return [{
      id: `${model.provider}/${model.id}`,
      reasoning: model.reasoning,
      ...(model.thinkingLevelMap ? { thinkingLevelMap: { ...model.thinkingLevelMap } } : {}),
      ...((model as KnownModelReasoningSource).defaultThinkingLevel
        ? { defaultThinkingLevel: (model as KnownModelReasoningSource).defaultThinkingLevel }
        : {}),
    }];
  });
}

export function looksLikeQwenModel(modelDef: CustomProviderModelDef): boolean {
  return [modelDef.id, modelDef.catalogModelId, modelDef.name].some(
    (value) => typeof value === 'string' && /qwen/i.test(value),
  );
}

/** Qwen3.8 official levels: xhigh / medium / low. Off is enable_thinking=false. */
const QWEN38_THINKING_LEVEL_MAP: ThinkingLevelMap = {
  off: 'none',
  minimal: null,
  low: 'low',
  medium: 'medium',
  high: null,
  xhigh: 'xhigh',
  max: null,
};

function looksLikeQwen38Model(modelDef: CustomProviderModelDef): boolean {
  return [modelDef.id, modelDef.catalogModelId, modelDef.name].some(
    (value) => typeof value === 'string' && /qwen3(?:[._-]?8|8)/i.test(value),
  );
}

export interface CustomModelReasoning {
  reasoning: boolean;
  thinkingLevelMap?: ThinkingLevelMap;
  defaultThinkingLevel?: (typeof PI_THINKING_LEVELS)[number];
}

/**
 * Advertised card metadata wins, then the Qwen3.8 preset, then a matching
 * built-in catalog row. A user override decides whether any of it applies.
 */
export function resolveCustomModelReasoning(
  modelDef: CustomProviderModelDef,
  meta: ReturnType<typeof defaultModelMeta>,
  knownModels: readonly KnownModelReasoningSource[],
): CustomModelReasoning {
  const inherited = meta.reasoningMeta
    ? undefined
    : findKnownModelReasoningSource(modelDef.catalogModelId ?? modelDef.id, knownModels)
      ?? (modelDef.catalogModelId
        ? findKnownModelReasoningSource(modelDef.id, knownModels)
        : undefined);
  const qwen38Preset = modelDef.reasoningOverride !== false && looksLikeQwen38Model(modelDef);
  const autoThinkingLevelMap = meta.reasoningMeta
    ? thinkingLevelMapFromEfforts(meta.reasoningMeta.supportedEfforts, {
      mandatory: meta.reasoningMeta.mandatory,
    })
    : qwen38Preset
      ? { ...QWEN38_THINKING_LEVEL_MAP }
      : inherited?.thinkingLevelMap
        ? { ...inherited.thinkingLevelMap }
        : undefined;
  const autoDefaultThinkingLevel = meta.reasoningMeta
    ? meta.reasoningMeta.defaultEnabled === false
      ? 'off' as const
      : meta.reasoningMeta.defaultEffort
    : qwen38Preset
      ? 'xhigh' as const
      : inherited?.defaultThinkingLevel;
  const autoReasoning = meta.reasoning || inherited?.reasoning === true || qwen38Preset;
  const reasoning = modelDef.reasoningOverride ?? autoReasoning;
  return {
    reasoning,
    ...(reasoning && autoThinkingLevelMap ? { thinkingLevelMap: autoThinkingLevelMap } : {}),
    ...(reasoning && autoDefaultThinkingLevel ? { defaultThinkingLevel: autoDefaultThinkingLevel } : {}),
  };
}

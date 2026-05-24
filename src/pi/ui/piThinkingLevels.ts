import type { ThinkingLevel } from '@earendil-works/pi-agent-core';
import * as piAi from '@earendil-works/pi-ai';
import {
  clampThinkingLevel,
  getSupportedThinkingLevels,
} from '@earendil-works/pi-ai';

import type { ChatReasoningOption } from '../../core/agent/types';
import { PI_AI_MODELS_CACHE } from './PiChatUIConfig';

/** Token budget hints aligned with pi-coding-agent TUI thinking selector. */
const THINKING_LEVEL_DESCRIPTIONS: Record<ThinkingLevel, string> = {
  off: 'No reasoning',
  minimal: 'Very brief reasoning (~1k tokens)',
  low: 'Light reasoning (~2k tokens)',
  medium: 'Moderate reasoning (~8k tokens)',
  high: 'Deep reasoning (~16k tokens)',
  xhigh: 'Maximum reasoning (~32k tokens)',
};

function formatThinkingLevelLabel(level: ThinkingLevel): string {
  if (level === 'xhigh') {
    return 'Max';
  }
  return level.charAt(0).toUpperCase() + level.slice(1);
}

type PiResolvedModel = NonNullable<ReturnType<typeof piAi.getModel>>;

function resolvePiModelFromKey(modelKey: string): PiResolvedModel | null {
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

export function getPiThinkingLevelOptions(modelKey: string): ChatReasoningOption[] {
  const model = resolvePiModelFromKey(modelKey);
  if (!model) {
    return [];
  }

  return getSupportedThinkingLevels(model).map((level) => ({
    value: level,
    label: formatThinkingLevelLabel(level),
    description: THINKING_LEVEL_DESCRIPTIONS[level],
  }));
}

export function isPiAdaptiveReasoningModel(modelKey: string): boolean {
  const options = getPiThinkingLevelOptions(modelKey);
  return options.some((option) => option.value !== 'off');
}

export function getPiDefaultThinkingLevel(
  modelKey: string,
  currentValue?: string,
): ThinkingLevel {
  const model = resolvePiModelFromKey(modelKey);
  if (!model) {
    return 'off';
  }

  const candidate = typeof currentValue === 'string' ? currentValue : 'medium';
  return clampThinkingLevel(model, candidate as ThinkingLevel);
}

export function resolvePiThinkingLevel(
  modelKey: string,
  thinkingLevel: string | undefined,
): ThinkingLevel {
  const model = resolvePiModelFromKey(modelKey);
  if (!model) {
    return 'off';
  }

  return clampThinkingLevel(model, (thinkingLevel ?? 'medium') as ThinkingLevel);
}

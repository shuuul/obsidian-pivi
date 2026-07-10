import type { ThinkingLevel } from '@earendil-works/pi-agent-core';
import type { Api, Model } from '@earendil-works/pi-ai';
import {
  clampThinkingLevel,
  getSupportedThinkingLevels,
} from '@earendil-works/pi-ai';

import type { ChatReasoningOption } from '../../foundation';

/** Token budget hints aligned with pi-coding-agent TUI thinking selector. */
const THINKING_LEVEL_DESCRIPTIONS: Record<ThinkingLevel, string> = {
  off: 'No reasoning',
  minimal: 'Very brief reasoning (~1k tokens)',
  low: 'Light reasoning (~2k tokens)',
  medium: 'Moderate reasoning (~8k tokens)',
  high: 'Deep reasoning (~16k tokens)',
  xhigh: 'Extra-high reasoning (~32k tokens)',
  max: 'Maximum model-supported reasoning',
};

function formatThinkingLevelLabel(level: ThinkingLevel): string {
  if (level === 'max') {
    return 'Max';
  }
  if (level === 'xhigh') {
    return 'Xhigh';
  }
  return level.charAt(0).toUpperCase() + level.slice(1);
}

export function getPiThinkingLevelOptionsForModel(model: Model<Api> | null): ChatReasoningOption[] {
  if (!model) {
    return [];
  }

  return getSupportedThinkingLevels(model).map((level) => ({
    value: level,
    label: formatThinkingLevelLabel(level),
    description: THINKING_LEVEL_DESCRIPTIONS[level],
  }));
}

export function isPiAdaptiveReasoningModelValue(model: Model<Api> | null): boolean {
  const options = getPiThinkingLevelOptionsForModel(model);
  return options.some((option) => option.value !== 'off');
}

export function getPiDefaultThinkingLevelForModel(
  model: Model<Api> | null,
  currentValue?: string,
): ThinkingLevel {
  if (!model) {
    return 'off';
  }

  const candidate = typeof currentValue === 'string' ? currentValue : 'medium';
  return clampThinkingLevel(model, candidate as ThinkingLevel);
}

export function resolvePiThinkingLevelForModel(
  model: Model<Api> | null,
  thinkingLevel: string | undefined,
): ThinkingLevel {
  if (!model) {
    return 'off';
  }

  return clampThinkingLevel(model, (thinkingLevel ?? 'medium') as ThinkingLevel);
}

import type { ThinkingLevel } from '@earendil-works/pi-agent-core';
import {
  clampThinkingLevel,
  getSupportedThinkingLevels,
} from '@earendil-works/pi-ai';

import type { ChatReasoningOption } from '../agent/chatUiTypes';
import { resolvePiModelFromKey } from '../runtime/resolvePiModelFromKey';

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

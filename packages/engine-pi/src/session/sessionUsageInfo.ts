import type { AgentMessage } from '@earendil-works/pi-agent-core';
import type { UsageInfo } from '@pivi/agent/runtime';

import { piAiModels } from '../models/piAiModels';
import {
  isPiModelContextWindowAuthoritative,
  resolvePiModelFromKeyWithLookup,
} from '../models/piModelRegistry';

/** Usage as the provider reported it on a persisted assistant message, or null when it reported none. */
export function usageInfoFromAssistantMessage(message: AgentMessage | undefined): UsageInfo | null {
  const msg = message as unknown as Record<string, unknown> | undefined;
  if (!msg || msg.role !== "assistant") {
    return null;
  }
  const usage = getRecord(msg.usage);
  const inputTokens = getNumber(usage.input);
  const outputTokens = getNumber(usage.output);
  const cacheReadInputTokens = getNumber(usage.cacheRead) ?? 0;
  const cacheCreationInputTokens = getNumber(usage.cacheWrite) ?? 0;
  const contextTokens = inputTokens === null
    ? getNumber(usage.totalTokens)
    : inputTokens + cacheReadInputTokens + cacheCreationInputTokens;
  if (contextTokens === null || contextTokens <= 0) {
    return null;
  }

  const modelKey = typeof msg.provider === "string" && typeof msg.model === "string"
    ? `${msg.provider}/${msg.model}`
    : null;
  const model = modelKey ? resolvePiModelFromKeyWithLookup(modelKey, piAiModels) : null;
  const contextWindow = model?.contextWindow ?? 0;
  const outputTokenLimit = model?.maxTokens;
  return {
    cacheCreationInputTokens,
    cacheReadInputTokens,
    contextTokens,
    contextTokensIsAuthoritative: true,
    contextWindow,
    contextWindowIsAuthoritative: isPiModelContextWindowAuthoritative(model),
    inputTokens: inputTokens ?? contextTokens,
    ...(modelKey ? { model: modelKey } : {}),
    ...(outputTokenLimit ? { outputTokenLimit } : {}),
    ...(outputTokens !== null ? { outputTokens } : {}),
    percentage: contextWindow > 0
      ? Math.min(100, Math.max(0, Math.round((contextTokens / contextWindow) * 100)))
      : 0,
  };
}

function getRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function getNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

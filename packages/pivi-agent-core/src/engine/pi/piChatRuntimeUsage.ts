import type { AgentMessage } from '@earendil-works/pi-agent-core';

import type { UsageInfo } from '../../foundation';
import type { resolvePiModel } from './piModelEnv';
import { isPiModelContextWindowAuthoritative } from './piModelRegistry';
import { estimateAgentMessagesTokens } from './session/piContextCompaction';

type ResolvedPiModel = ReturnType<typeof resolvePiModel>;

function getRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function getNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function buildUsageInfoFromAgentMessage(
  message: AgentMessage,
  resolvedModel: ResolvedPiModel,
): UsageInfo | null {
  const msg = message as unknown as Record<string, unknown>;
  if (msg.role !== 'assistant') {
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

  const contextWindow = resolvedModel?.contextWindow ?? 0;
  const outputTokenLimit = resolvedModel?.maxTokens;
  return {
    cacheCreationInputTokens,
    cacheReadInputTokens,
    contextTokens,
    contextTokensIsAuthoritative: true,
    contextWindow,
    contextWindowIsAuthoritative: isPiModelContextWindowAuthoritative(resolvedModel),
    inputTokens: inputTokens ?? contextTokens,
    ...(typeof msg.model === 'string' ? { model: msg.model } : {}),
    ...(outputTokenLimit ? { outputTokenLimit } : {}),
    ...(outputTokens !== null ? { outputTokens } : {}),
    percentage: contextWindow > 0
      ? Math.min(100, Math.max(0, Math.round((contextTokens / contextWindow) * 100)))
      : 0,
  };
}

export function buildEstimatedUsageInfo(
  messages: AgentMessage[],
  resolvedModel: ResolvedPiModel,
): UsageInfo | null {
  const contextTokens = estimateAgentMessagesTokens(messages);
  if (contextTokens <= 0) {
    return null;
  }
  const contextWindow = resolvedModel?.contextWindow ?? 0;
  return {
    contextTokens,
    contextTokensIsAuthoritative: false,
    contextWindow,
    contextWindowIsAuthoritative: isPiModelContextWindowAuthoritative(resolvedModel),
    inputTokens: contextTokens,
    ...(resolvedModel?.maxTokens ? { outputTokenLimit: resolvedModel.maxTokens } : {}),
    ...(typeof resolvedModel?.id === 'string' ? { model: resolvedModel.id } : {}),
    percentage: contextWindow > 0
      ? Math.min(100, Math.max(0, Math.round((contextTokens / contextWindow) * 100)))
      : 0,
  };
}

export function latestUsageFromMessages(
  messages: AgentMessage[],
  resolvedModel: ResolvedPiModel,
): UsageInfo | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (!message) {
      continue;
    }
    const usage = buildUsageInfoFromAgentMessage(message, resolvedModel);
    if (usage) {
      return usage;
    }
  }
  return null;
}

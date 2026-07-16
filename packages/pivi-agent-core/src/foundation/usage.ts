import type { ContextEnvelope, ContextEnvelopeValue, UsageInfo } from './chat';

export const DEFAULT_CONTEXT_WINDOW_TOKENS = 200_000;
export const DEFAULT_RESERVED_OUTPUT_TOKENS = 16_000;
export const DEFAULT_COMPACTION_RESERVE_TOKENS = 12_000;
export const DEFAULT_CONTEXT_SAFETY_MARGIN_TOKENS = 8_000;

const OUTPUT_RESERVE_WINDOW_RATIO = 0.25;
const COMPACTION_RESERVE_WINDOW_RATIO = 0.1;
const SAFETY_MARGIN_WINDOW_RATIO = 0.05;

export interface ContextEnvelopeInput {
  checkpoints?: number;
  compactionReserveTokens?: number;
  contextWindow?: number;
  contextWindowIsAuthoritative?: boolean;
  outputTokenLimit?: number;
  providerContextTokens?: number;
  recentConversation?: number;
  reservedOutputTokens?: number;
  safetyMarginTokens?: number;
  selectedContext?: number;
  system?: number;
  thresholdRatio?: number;
  toolAndAgentResults?: number;
}

function normalizeTokens(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.round(value))
    : 0;
}

function estimate(tokens: number | undefined): ContextEnvelopeValue {
  return { source: 'estimated', tokens: normalizeTokens(tokens) };
}

function cappedReserve(
  explicit: number | undefined,
  defaultTokens: number,
  contextWindow: number,
  windowRatio: number,
): number {
  const maximumReserve = Math.min(defaultTokens, Math.floor(contextWindow * windowRatio));
  if (typeof explicit === 'number' && Number.isFinite(explicit)) {
    return Math.min(normalizeTokens(explicit), maximumReserve);
  }
  return maximumReserve;
}

/**
 * Builds a conservative tokenizer-independent context budget. Only a
 * provider-reported total is authoritative; category splits remain estimates.
 */
export function calculateContextEnvelope(input: ContextEnvelopeInput): ContextEnvelope {
  const reportedContextWindow = normalizeTokens(input.contextWindow);
  const contextWindowTokens = reportedContextWindow || DEFAULT_CONTEXT_WINDOW_TOKENS;
  const contextWindow: ContextEnvelopeValue = {
    source: reportedContextWindow > 0 && input.contextWindowIsAuthoritative === true
      ? 'authoritative'
      : 'estimated',
    tokens: contextWindowTokens,
  };
  const reservedOutputTokens = cappedReserve(
    input.reservedOutputTokens ?? input.outputTokenLimit,
    DEFAULT_RESERVED_OUTPUT_TOKENS,
    contextWindowTokens,
    OUTPUT_RESERVE_WINDOW_RATIO,
  );
  const compactionReserveTokens = cappedReserve(
    input.compactionReserveTokens,
    DEFAULT_COMPACTION_RESERVE_TOKENS,
    contextWindowTokens,
    COMPACTION_RESERVE_WINDOW_RATIO,
  );
  const safetyMarginTokens = cappedReserve(
    input.safetyMarginTokens,
    DEFAULT_CONTEXT_SAFETY_MARGIN_TOKENS,
    contextWindowTokens,
    SAFETY_MARGIN_WINDOW_RATIO,
  );
  const usableInputTokens = Math.max(
    0,
    contextWindowTokens - reservedOutputTokens - compactionReserveTokens - safetyMarginTokens,
  );
  const thresholdRatio = Math.min(0.95, Math.max(0.5, input.thresholdRatio ?? 0.9));
  const ratioTriggerTokens = Math.floor(contextWindowTokens * thresholdRatio);
  const system = estimate(input.system);
  const recentConversation = estimate(input.recentConversation);
  const selectedContext = estimate(input.selectedContext);
  const toolAndAgentResults = estimate(input.toolAndAgentResults);
  const checkpoints = estimate(input.checkpoints);
  const estimatedTotal = system.tokens
    + recentConversation.tokens
    + selectedContext.tokens
    + toolAndAgentResults.tokens
    + checkpoints.tokens;
  const providerContextTokens = normalizeTokens(input.providerContextTokens);

  return {
    checkpoints,
    compactionReserve: estimate(compactionReserveTokens),
    compactionTriggerTokens: Math.min(usableInputTokens, ratioTriggerTokens),
    contextWindow,
    estimatedInputTokens: estimatedTotal,
    pressureInputTokens: Math.max(providerContextTokens, estimatedTotal),
    recentConversation,
    reservedOutput: estimate(reservedOutputTokens),
    safetyMargin: estimate(safetyMarginTokens),
    selectedContext,
    system,
    toolAndAgentResults,
    total: providerContextTokens > 0
      ? { source: 'authoritative', tokens: providerContextTokens }
      : estimate(estimatedTotal),
    usableInputTokens,
  };
}

export function calculateUsagePercentage(tokens: number, limit: number): number {
  return limit > 0
    ? Math.min(100, Math.max(0, Math.round((tokens / limit) * 100)))
    : 0;
}

/** Context-window metric: all provider-reported prompt context against the model limit. */
export function calculateContextUsagePercentage(usage: UsageInfo): number {
  return calculateUsagePercentage(usage.contextTokens, usage.contextWindow);
}

export function recalculateUsageForModel(
  usage: UsageInfo,
  model: string,
  fallbackContextWindow: number | null,
): UsageInfo {
  const preserveAuthoritativeWindow = usage.contextWindowIsAuthoritative === true
    && usage.contextWindow > 0
    && usage.model === model;
  const contextWindow = preserveAuthoritativeWindow
    ? usage.contextWindow
    : fallbackContextWindow ?? 0;
  const outputTokenLimit = usage.model === model ? usage.outputTokenLimit : undefined;
  const previousEnvelope = usage.contextEnvelope;
  const contextEnvelope = previousEnvelope
    ? calculateContextEnvelope({
        checkpoints: previousEnvelope.checkpoints.tokens,
        contextWindow,
        contextWindowIsAuthoritative: preserveAuthoritativeWindow,
        outputTokenLimit,
        providerContextTokens: usage.contextTokensIsAuthoritative
          ? usage.contextTokens
          : undefined,
        recentConversation: previousEnvelope.recentConversation.tokens,
        selectedContext: previousEnvelope.selectedContext.tokens,
        system: previousEnvelope.system.tokens,
        toolAndAgentResults: previousEnvelope.toolAndAgentResults.tokens,
      })
    : undefined;

  return {
    ...usage,
    ...(contextEnvelope ? { contextEnvelope } : {}),
    model,
    contextWindow,
    contextWindowIsAuthoritative: preserveAuthoritativeWindow,
    ...(outputTokenLimit ? { outputTokenLimit } : { outputTokenLimit: undefined }),
    percentage: calculateUsagePercentage(usage.contextTokens, contextWindow),
  };
}

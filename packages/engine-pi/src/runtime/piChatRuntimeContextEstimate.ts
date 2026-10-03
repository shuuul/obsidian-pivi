/** Context pressure estimation for the chat runtime: provider-anchored usage, system/tool overhead, and compaction thresholds. */

import type {
  Agent,
  AgentMessage,
} from '@earendil-works/pi-agent-core';
import {
  calculateContextEnvelope,
  calculateUsagePercentage,
  type UsageInfo,
} from '@pivi/agent/runtime';
import {
  calibrateTokenEstimate,
  observeProviderUsage,
} from '@pivi/agent/runtime/contextAccounting';
import type { PreparedChatTurn } from '@pivi/agent/runtime/types';

import type { PiResolvedModel } from '../models/piModelRegistry';
import { isPiModelContextWindowAuthoritative } from '../models/piModelRegistry';
import { missingAgentMessages } from '../session/agentMessageHistory';
import {
  DEFAULT_COMPACTION_CONTEXT_WINDOW,
  estimateActiveContextCategories,
  estimateActiveContextTokens,
  estimateAgentMessageCategories,
  estimateAgentMessagesTokens,
  estimateTextTokens,
  getCompactionThresholdTokens as computeCompactionThresholdTokens,
  PiContextTokenIndex,
} from '../session/piContextCompaction';
import type { SessionTreeStore } from '../session/sessionTreeStore';
import type {
  PiChatCompactionDeps,
} from './piChatRuntimeCompaction';

const contextTokenIndexes = new WeakMap<SessionTreeStore, PiContextTokenIndex>();

const systemTokenEstimateCache = new WeakMap<Agent, {
  systemPrompt: string;
  tokens: number;
  tools: unknown;
}>();

function getContextTokenIndex(sessionTree: SessionTreeStore): PiContextTokenIndex {
  let index = contextTokenIndexes.get(sessionTree);
  if (!index) {
    index = new PiContextTokenIndex();
    contextTokenIndexes.set(sessionTree, index);
  }
  return index;
}

export function estimateSessionEntriesTokens(sessionTree: SessionTreeStore): number {
  return estimateActiveContextTokens(
    sessionTree.getLinearLlmContextEntries(),
    getContextTokenIndex(sessionTree),
  );
}

function estimateSystemTokens(agent: Agent | null): number {
  if (!agent) {
    return estimateTextTokens('') + estimateTextTokens(JSON.stringify([]));
  }
  const systemPrompt = agent.state.systemPrompt ?? '';
  const tools = agent.state.tools ?? [];
  const cached = systemTokenEstimateCache.get(agent);
  if (cached && cached.tools === tools && cached.systemPrompt === systemPrompt) {
    return cached.tokens;
  }
  const tokens = estimateTextTokens(systemPrompt) + estimateTextTokens(JSON.stringify(
    tools.map((tool) => ({
      description: tool.description,
      name: tool.name,
      parameters: (tool as { parameters?: unknown }).parameters,
    })),
  ));
  systemTokenEstimateCache.set(agent, { systemPrompt, tokens, tools });
  return tokens;
}

function assistantProviderTokens(message: AgentMessage): number | null {
  const record = message as unknown as Record<string, unknown>;
  if (
    record.role !== 'assistant'
    || record.stopReason === 'aborted'
    || record.stopReason === 'error'
  ) {
    return null;
  }
  const usage = record.usage;
  if (!usage || typeof usage !== 'object' || Array.isArray(usage)) {
    return null;
  }
  const values = usage as Record<string, unknown>;
  const total = typeof values.totalTokens === 'number' ? values.totalTokens : 0;
  const input = typeof values.input === 'number' ? values.input : 0;
  const output = typeof values.output === 'number' ? values.output : 0;
  const cacheRead = typeof values.cacheRead === 'number' ? values.cacheRead : 0;
  const cacheWrite = typeof values.cacheWrite === 'number' ? values.cacheWrite : 0;
  const tokens = total > 0 ? total : input + output + cacheRead + cacheWrite;
  return tokens > 0 ? tokens : null;
}

function assistantMatchesModel(message: AgentMessage, model: PiResolvedModel): boolean {
  const record = message as unknown as Record<string, unknown>;
  return record.provider === model.provider && record.model === model.id;
}

interface ProviderAnchorProjection {
  calibration: number;
  tokens: number;
  trailingTokens: number;
}

function findProviderAnchor(
  deps: PiChatCompactionDeps,
  pendingMessages: AgentMessage[] = [],
): ProviderAnchorProjection | null {
  const entries = deps.sessionTree?.getLinearLlmContextEntries() ?? [];
  const index = deps.sessionTree ? getContextTokenIndex(deps.sessionTree) : new PiContextTokenIndex();
  index.sync(entries);
  const pendingOnly = deps.sessionTree && pendingMessages.length > 0
    ? missingAgentMessages(deps.sessionTree.loadAgentMessages(), pendingMessages)
    : pendingMessages;
  const model = deps.resolveModel();
  if (!model) return null;
  const key = `${model.provider}/${model.id}`;
  for (let pendingIndex = pendingOnly.length - 1; pendingIndex >= 0; pendingIndex--) {
    const message = pendingOnly[pendingIndex];
    if (!message || !assistantMatchesModel(message, model)) continue;
    const tokens = assistantProviderTokens(message);
    if (!tokens) continue;
    const localAtAnchor = estimateSystemTokens(deps.agent)
      + index.tokensBetween(0)
      + estimateAgentMessagesTokens(pendingOnly.slice(0, pendingIndex + 1));
    const calibration = observeProviderUsage(key, tokens, localAtAnchor);
    return {
      calibration,
      tokens,
      trailingTokens: calibrateTokenEstimate(
        estimateAgentMessagesTokens(pendingOnly.slice(pendingIndex + 1)),
        calibration,
      ),
    };
  }
  for (let entryIndex = entries.length - 1; entryIndex >= 0; entryIndex--) {
    const entry = entries[entryIndex];
    if (!entry || entry.type !== 'message' || !('message' in entry)) continue;
    if (!assistantMatchesModel(entry.message, model)) continue;
    const tokens = assistantProviderTokens(entry.message);
    if (!tokens) continue;
    const localAtAnchor = estimateSystemTokens(deps.agent) + index.tokensBetween(0, entryIndex + 1);
    const calibration = observeProviderUsage(key, tokens, localAtAnchor);
    return {
      calibration,
      tokens,
      trailingTokens: calibrateTokenEstimate(
        index.tokensBetween(entryIndex + 1) + estimateAgentMessagesTokens(pendingOnly),
        calibration,
      ),
    };
  }
  return null;
}

function authoritativeReservedOutputTokens(model: PiResolvedModel | null): number | undefined {
  return model?.outputTokenLimitIsAuthoritative ? model.maxTokens : undefined;
}

export function attachContextEnvelope(
  deps: PiChatCompactionDeps,
  usage: UsageInfo,
  turn?: PreparedChatTurn,
  pendingMessages: AgentMessage[] = [],
  options: { currentTurnAlreadyCounted?: boolean } = {},
): UsageInfo {
  const categories = deps.sessionTree
    ? estimateActiveContextCategories(deps.sessionTree.getLinearLlmContextEntries())
    : estimateAgentMessageCategories(
        pendingMessages.length > 0 ? pendingMessages : deps.agent?.state.messages ?? [],
      );
  if (deps.sessionTree && pendingMessages.length > 0) {
    const pendingOnly = missingAgentMessages(
      deps.sessionTree.loadAgentMessages(),
      pendingMessages,
    );
    const pending = estimateAgentMessageCategories(pendingOnly.filter((message) => (
      (message as unknown as { role?: unknown }).role !== 'user'
    )));
    categories.recentConversation += pending.recentConversation;
    categories.toolAndAgentResults += pending.toolAndAgentResults;
  }
  const selectedContext = deps.sessionTree && turn && !options.currentTurnAlreadyCounted
    ? Math.max(0, estimateTextTokens(turn.prompt) - estimateTextTokens(turn.persistedContent))
    : 0;
  const resolvedModel = deps.resolveModel();
  const anchor = findProviderAnchor(deps, pendingMessages);
  const providerAnchorTokens = anchor?.tokens
    ?? (usage.contextTokensIsAuthoritative ? usage.contextTokens : undefined);
  const calibratedSelectedContext = anchor
    ? calibrateTokenEstimate(selectedContext, anchor.calibration)
    : selectedContext;
  const contextEnvelope = calculateContextEnvelope({
    checkpoints: categories.checkpoints,
    contextWindow: usage.contextWindow || DEFAULT_COMPACTION_CONTEXT_WINDOW,
    contextWindowIsAuthoritative: usage.contextWindowIsAuthoritative,
    outputTokenLimit: usage.outputTokenLimit,
    providerContextTokens: providerAnchorTokens,
    recentConversation: categories.recentConversation,
    reservedOutputTokens: authoritativeReservedOutputTokens(resolvedModel),
    selectedContext: calibratedSelectedContext,
    system: estimateSystemTokens(deps.agent),
    toolAndAgentResults: categories.toolAndAgentResults,
    trailingEstimateTokens: anchor?.trailingTokens,
  });
  if (usage.contextTokensIsAuthoritative) {
    return { ...usage, contextEnvelope };
  }
  const contextTokens = contextEnvelope.pressureInputTokens;
  return {
    ...usage,
    contextEnvelope,
    contextTokens,
    inputTokens: contextTokens,
    percentage: calculateUsagePercentage(contextTokens, usage.contextWindow),
  };
}

/** Rebuild composer usage from the compacted active session instead of stale provider totals. */
export function buildUsageAfterCompaction(
  deps: PiChatCompactionDeps,
  turn?: PreparedChatTurn,
  tokensAfter?: number,
): UsageInfo | null {
  const conversationTokens = tokensAfter ?? estimateStoredConversationTokens(deps);
  if (conversationTokens <= 0) {
    return null;
  }
  const resolvedModel = deps.resolveModel();
  const contextWindow = resolvedModel?.contextWindow ?? 0;
  const selectedContext = deps.sessionTree && turn
    ? Math.max(0, estimateTextTokens(turn.prompt) - estimateTextTokens(turn.persistedContent))
    : 0;
  const contextEnvelope = calculateContextEnvelope({
    contextWindow,
    contextWindowIsAuthoritative: isPiModelContextWindowAuthoritative(resolvedModel),
    outputTokenLimit: resolvedModel?.maxTokens,
    recentConversation: conversationTokens,
    reservedOutputTokens: authoritativeReservedOutputTokens(resolvedModel),
    selectedContext,
    system: estimateSystemTokens(deps.agent),
    toolAndAgentResults: 0,
  });
  const contextTokens = contextEnvelope.total.tokens;
  return {
    contextTokens,
    contextTokensIsAuthoritative: false,
    contextWindow,
    contextWindowIsAuthoritative: isPiModelContextWindowAuthoritative(resolvedModel),
    contextEnvelope,
    inputTokens: contextTokens,
    ...(resolvedModel?.maxTokens ? { outputTokenLimit: resolvedModel.maxTokens } : {}),
    ...(typeof resolvedModel?.id === 'string' ? { model: resolvedModel.id } : {}),
    percentage: calculateUsagePercentage(contextTokens, contextWindow),
  };
}

export function getCompactionThresholdTokens(
  deps: PiChatCompactionDeps,
  contextWindow = deps.resolveModel()?.contextWindow ?? DEFAULT_COMPACTION_CONTEXT_WINDOW,
): number {
  const model = deps.resolveModel();
  return computeCompactionThresholdTokens(
    contextWindow,
    isPiModelContextWindowAuthoritative(model),
    model?.maxTokens,
    authoritativeReservedOutputTokens(model),
  );
}

export function estimateStoredConversationTokens(deps: PiChatCompactionDeps): number {
  return deps.sessionTree ? estimateSessionEntriesTokens(deps.sessionTree) : 0;
}

export function estimateProjectedTurnTokens(
  deps: PiChatCompactionDeps,
  turn: PreparedChatTurn,
): number {
  const anchor = findProviderAnchor(deps);
  if (anchor) {
    return anchor.tokens
      + anchor.trailingTokens
      + calibrateTokenEstimate(estimateTextTokens(turn.prompt), anchor.calibration);
  }
  const sessionTokens = deps.sessionTree
    ? estimateSessionEntriesTokens(deps.sessionTree)
    : estimateAgentMessagesTokens(deps.agent?.state.messages ?? []);
  return sessionTokens + estimateSystemTokens(deps.agent) + estimateTextTokens(turn.prompt);
}

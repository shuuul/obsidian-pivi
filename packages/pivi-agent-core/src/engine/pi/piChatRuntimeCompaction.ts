import type { Agent, AgentMessage } from '@earendil-works/pi-agent-core';

import {
  calculateContextEnvelope,
  type UsageInfo,
} from '../../foundation';
import type { StreamChunkQueue } from '../../runtime/streamChunkQueue';
import type { PreparedChatTurn } from '../../runtime/types';
import { createPiAuxQueryRunner } from './piAuxQueryRunner';
import type { resolvePiModel } from './piModelEnv';
import { isPiModelContextWindowAuthoritative } from './piModelRegistry';
import type { PiRuntimeHost } from './piRuntimeHost';
import type { MissingAgentMessagesOptions } from './session/agentMessageHistory';
import {
  buildCheckpoint,
  buildCompactionPrompt,
  buildCompactionSummary,
  COMPACTION_SYSTEM_PROMPT,
  DEFAULT_COMPACTION_CONTEXT_WINDOW,
  estimateActiveContextCategories,
  estimateActiveContextTokens,
  estimateAgentMessageCategories,
  estimateAgentMessagesTokens,
  estimateTextTokens,
  findLatestCheckpoint,
  getCompactionThresholdTokens as computeCompactionThresholdTokens,
  PiContextTokenIndex,
  renderCheckpoint,
  selectCompactionCutPoint,
  shouldAutoCompact,
} from './session/piContextCompaction';
import type { SessionTreeStore } from './session/sessionTreeStore';
import type { SubagentConcurrencyLimiter } from './subagentConcurrencyLimiter';

export interface PiChatCompactionState {
  autoCompactionInFlight: boolean;
  lastAutoCompactionAttemptLeafId: string | null;
}

export interface PiChatCompactionResult {
  tokensAfter: number;
  tokensBefore: number;
}

export interface PiChatCompactionDeps {
  plugin: PiRuntimeHost;
  sessionTree: SessionTreeStore | null;
  agent: Agent | null;
  compactionState: PiChatCompactionState;
  subagentConcurrencyLimiter?: SubagentConcurrencyLimiter;
  resolveModel: () => ReturnType<typeof resolvePiModel>;
  getAuxiliaryModel: () => string | null;
  onLeafIdChanged: (leafId: string | null) => void;
  onAssistantMessageId: (entryId: string) => void;
}

const contextTokenIndexes = new WeakMap<SessionTreeStore, PiContextTokenIndex>();

function getContextTokenIndex(sessionTree: SessionTreeStore): PiContextTokenIndex {
  let index = contextTokenIndexes.get(sessionTree);
  if (!index) {
    index = new PiContextTokenIndex();
    contextTokenIndexes.set(sessionTree, index);
  }
  return index;
}

function estimateSessionEntriesTokens(sessionTree: SessionTreeStore): number {
  const entries = sessionTree.getLinearLlmContextEntries();
  const index = getContextTokenIndex(sessionTree);
  return estimateActiveContextTokens(entries, index);
}

function estimateSystemTokens(agent: Agent | null): number {
  const systemPromptTokens = estimateTextTokens(agent?.state.systemPrompt ?? '');
  const toolSchemaTokens = estimateTextTokens(JSON.stringify(
    (agent?.state.tools ?? []).map((tool) => ({
      description: tool.description,
      name: tool.name,
      parameters: (tool as { parameters?: unknown }).parameters,
    })),
  ));
  return systemPromptTokens + toolSchemaTokens;
}

export function attachContextEnvelope(
  deps: PiChatCompactionDeps,
  usage: UsageInfo,
  turn?: PreparedChatTurn,
  pendingMessages: AgentMessage[] = [],
): UsageInfo {
  const categories = deps.sessionTree
    ? estimateActiveContextCategories(deps.sessionTree.getLinearLlmContextEntries())
    : estimateAgentMessageCategories(
        pendingMessages.length > 0 ? pendingMessages : deps.agent?.state.messages ?? [],
      );
  if (deps.sessionTree && pendingMessages.length > 0) {
    const pending = estimateAgentMessageCategories(pendingMessages);
    categories.recentConversation += pending.recentConversation;
    categories.toolAndAgentResults += pending.toolAndAgentResults;
  }
  const selectedContext = deps.sessionTree && turn
    ? Math.max(0, estimateTextTokens(turn.prompt) - estimateTextTokens(turn.persistedContent))
    : 0;
  return {
    ...usage,
    contextEnvelope: calculateContextEnvelope({
      checkpoints: categories.checkpoints,
      contextWindow: usage.contextWindow || DEFAULT_COMPACTION_CONTEXT_WINDOW,
      contextWindowIsAuthoritative: usage.contextWindowIsAuthoritative,
      outputTokenLimit: usage.outputTokenLimit,
      providerContextTokens: usage.contextTokensIsAuthoritative
        ? usage.contextTokens
        : undefined,
      recentConversation: categories.recentConversation,
      selectedContext,
      system: estimateSystemTokens(deps.agent),
      thresholdRatio: deps.plugin.settings.autoCompactThresholdRatio,
      toolAndAgentResults: categories.toolAndAgentResults,
    }),
  };
}

export function shouldAutoCompactSession(
  deps: PiChatCompactionDeps,
  providerUsage: UsageInfo,
): boolean {
  if (!deps.sessionTree) {
    return false;
  }
  return shouldAutoCompact({
    enableAutoCompact: deps.plugin.settings.enableAutoCompact,
    compactionInFlight: deps.compactionState.autoCompactionInFlight,
    sessionLeafId: deps.sessionTree.getLeafId(),
    lastAttemptLeafId: deps.compactionState.lastAutoCompactionAttemptLeafId,
    providerUsage,
    storedConversationTokens: estimateStoredConversationTokens(deps),
    thresholdRatio: deps.plugin.settings.autoCompactThresholdRatio,
  });
}

export function getCompactionThresholdTokens(
  deps: PiChatCompactionDeps,
  contextWindow = deps.resolveModel()?.contextWindow ?? DEFAULT_COMPACTION_CONTEXT_WINDOW,
): number {
  const model = deps.resolveModel();
  return computeCompactionThresholdTokens(
    contextWindow,
    deps.plugin.settings.autoCompactThresholdRatio,
    isPiModelContextWindowAuthoritative(model),
    model?.maxTokens,
  );
}

export function estimateStoredConversationTokens(deps: PiChatCompactionDeps): number {
  if (!deps.sessionTree) {
    return 0;
  }
  return estimateSessionEntriesTokens(deps.sessionTree);
}

export function estimateProjectedTurnTokens(
  deps: PiChatCompactionDeps,
  turn: PreparedChatTurn,
): number {
  const sessionTokens = deps.sessionTree
    ? estimateSessionEntriesTokens(deps.sessionTree)
    : estimateAgentMessagesTokens(deps.agent?.state.messages ?? []);
  return sessionTokens + estimateSystemTokens(deps.agent) + estimateTextTokens(turn.prompt);
}

export function canCompactCurrentSession(deps: PiChatCompactionDeps): boolean {
  if (!deps.sessionTree) {
    return false;
  }
  return selectCompactionCutPoint(
    deps.sessionTree.getLinearLlmContextEntries(),
    deps.plugin.settings.autoCompactKeepRecentTokens,
    getContextTokenIndex(deps.sessionTree),
  ) !== null;
}

export async function prepareContextForTurn(
  deps: PiChatCompactionDeps,
  turn: PreparedChatTurn,
  queue: StreamChunkQueue,
): Promise<boolean | null> {
  if (!deps.plugin.settings.enableAutoCompact || !deps.sessionTree) {
    return false;
  }

  if (!isPiModelContextWindowAuthoritative(deps.resolveModel())) {
    return false;
  }

  const thresholdTokens = getCompactionThresholdTokens(deps);
  if (estimateProjectedTurnTokens(deps, turn) <= thresholdTokens) {
    return false;
  }

  let compacted = false;
  if (canCompactCurrentSession(deps)) {
    queue.push({ type: 'context_compacting' });
    const compaction = await compactCurrentSession(
      deps,
      'threshold',
      'Preflight compaction before sending the next user turn because the projected context would exceed the configured threshold.',
    );
    compacted = compaction !== null;
    if (compaction) {
      queue.push({ type: 'context_compacted', ...compaction });
    }
  }

  if (estimateProjectedTurnTokens(deps, turn) <= thresholdTokens) {
    return compacted;
  }

  queue.push({
    type: 'error',
    content: 'This turn is too large to send safely within the configured context threshold. Reduce attached context, use obsidian_read with line ranges, or deliberately raise maxChars only for files you need in full.',
  });
  return null;
}

export async function compactCurrentSession(
  deps: PiChatCompactionDeps,
  reason: 'manual' | 'threshold',
  instructions?: string,
): Promise<PiChatCompactionResult | null> {
  if (!deps.sessionTree) {
    return null;
  }
  const attemptLeafId = deps.sessionTree.getLeafId();
  if (reason === 'threshold') {
    if (!attemptLeafId || deps.compactionState.lastAutoCompactionAttemptLeafId === attemptLeafId) {
      return null;
    }
  }

  const entries = deps.sessionTree.getLinearLlmContextEntries();
  const cutPoint = selectCompactionCutPoint(
    entries,
    deps.plugin.settings.autoCompactKeepRecentTokens,
    getContextTokenIndex(deps.sessionTree),
  );
  if (!cutPoint) {
    return null;
  }

  deps.compactionState.autoCompactionInFlight = true;
  try {
    const runner = createPiAuxQueryRunner(deps.plugin, {
      subagentConcurrencyLimiter: deps.subagentConcurrencyLimiter,
    });
    try {
      const summaryText = await runner.query({
        model: deps.getAuxiliaryModel() ?? undefined,
        systemPrompt: COMPACTION_SYSTEM_PROMPT,
      }, buildCompactionPrompt(cutPoint.prefixEntries, instructions));
      const checkpoint = buildCheckpoint(
        summaryText,
        cutPoint,
        findLatestCheckpoint(entries),
      );
      const summary = buildCompactionSummary(
        checkpoint ? renderCheckpoint(checkpoint) : summaryText,
      );
      const compactionId = deps.sessionTree.appendCompaction(
        summary,
        cutPoint.firstKeptEntryId,
        cutPoint.tokensBefore,
        checkpoint ? { piviCheckpoint: checkpoint } : undefined,
      );
      deps.onLeafIdChanged(deps.sessionTree.getLeafId());
      deps.onAssistantMessageId(compactionId);
      if (reason === 'threshold') {
        deps.compactionState.lastAutoCompactionAttemptLeafId = deps.sessionTree.getLeafId();
      }
      if (deps.agent) {
        deps.agent.state.messages = deps.sessionTree.loadAgentMessages();
      }
      return {
        tokensAfter: estimateSessionEntriesTokens(deps.sessionTree),
        tokensBefore: cutPoint.tokensBefore,
      };
    } finally {
      runner.reset();
    }
  } finally {
    deps.compactionState.autoCompactionInFlight = false;
  }
}

export function buildTurnSyncOptions(turn?: PreparedChatTurn): MissingAgentMessagesOptions | undefined {
  if (!turn || turn.persistedContent === turn.prompt) {
    return undefined;
  }
  return {
    userMessageEquivalences: [{
      existingText: turn.persistedContent,
      incomingText: turn.prompt,
    }],
  };
}

export function syncSessionMessagesAfterTurn(
  sessionTree: SessionTreeStore | null,
  messages: AgentMessage[],
  turn: PreparedChatTurn | undefined,
  onLeafIdChanged: (leafId: string | null) => void,
  onAssistantMessageId: (entryId: string | undefined) => void,
): void {
  if (!sessionTree || messages.length === 0) {
    return;
  }
  sessionTree.syncAgentMessages(messages, buildTurnSyncOptions(turn));
  onLeafIdChanged(sessionTree.getLeafId());
  onAssistantMessageId(
    sessionTree.findLastVisibleMessageEntryId('assistant') ?? undefined,
  );
}

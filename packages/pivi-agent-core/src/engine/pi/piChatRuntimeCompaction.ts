import type { Agent, AgentMessage } from '@earendil-works/pi-agent-core';

import type { UsageInfo } from '../../foundation';
import type { StreamChunkQueue } from '../../runtime/streamChunkQueue';
import type { PreparedChatTurn } from '../../runtime/types';
import { createPiAuxQueryRunner } from './piAuxQueryRunner';
import type { resolvePiModel } from './piModelEnv';
import { isPiModelContextWindowAuthoritative } from './piModelRegistry';
import type { PiRuntimeHost } from './piRuntimeHost';
import type { MissingAgentMessagesOptions } from './session/agentMessageHistory';
import {
  buildCompactionPrompt,
  buildCompactionSummary,
  COMPACTION_SYSTEM_PROMPT,
  DEFAULT_COMPACTION_CONTEXT_WINDOW,
  estimateAgentMessagesTokens,
  estimateTextTokens,
  getCompactionThresholdTokens as computeCompactionThresholdTokens,
  selectCompactionCutPoint,
  shouldAutoCompact,
} from './session/piContextCompaction';
import type { SessionTreeStore } from './session/sessionTreeStore';
import type { SubagentConcurrencyLimiter } from './subagentConcurrencyLimiter';

export interface PiChatCompactionState {
  autoCompactionInFlight: boolean;
  lastAutoCompactionAttemptLeafId: string | null;
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
  return computeCompactionThresholdTokens(contextWindow, deps.plugin.settings.autoCompactThresholdRatio);
}

export function estimateStoredConversationTokens(deps: PiChatCompactionDeps): number {
  if (!deps.sessionTree) {
    return 0;
  }
  return estimateAgentMessagesTokens(deps.sessionTree.loadAgentMessages());
}

export function estimateProjectedTurnTokens(
  deps: PiChatCompactionDeps,
  turn: PreparedChatTurn,
): number {
  const sessionTokens = deps.sessionTree
    ? estimateAgentMessagesTokens(deps.sessionTree.loadAgentMessages())
    : estimateAgentMessagesTokens(deps.agent?.state.messages ?? []);
  return sessionTokens + estimateTextTokens(turn.prompt);
}

export function canCompactCurrentSession(deps: PiChatCompactionDeps): boolean {
  if (!deps.sessionTree) {
    return false;
  }
  return selectCompactionCutPoint(
    deps.sessionTree.getLinearLlmContextEntries(),
    deps.plugin.settings.autoCompactKeepRecentTokens,
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
    compacted = await compactCurrentSession(
      deps,
      'threshold',
      'Preflight compaction before sending the next user turn because the projected context would exceed the configured threshold.',
    );
    if (compacted) {
      queue.push({ type: 'context_compacted' });
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
): Promise<boolean> {
  if (!deps.sessionTree) {
    return false;
  }
  const attemptLeafId = deps.sessionTree.getLeafId();
  if (reason === 'threshold') {
    if (!attemptLeafId || deps.compactionState.lastAutoCompactionAttemptLeafId === attemptLeafId) {
      return false;
    }
  }

  const entries = deps.sessionTree.getLinearLlmContextEntries();
  const cutPoint = selectCompactionCutPoint(
    entries,
    deps.plugin.settings.autoCompactKeepRecentTokens,
  );
  if (!cutPoint) {
    return false;
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
      const summary = buildCompactionSummary(summaryText);
      const compactionId = deps.sessionTree.appendCompaction(
        summary,
        cutPoint.firstKeptEntryId,
        cutPoint.tokensBefore,
      );
      deps.onLeafIdChanged(deps.sessionTree.getLeafId());
      deps.onAssistantMessageId(compactionId);
      if (reason === 'threshold') {
        deps.compactionState.lastAutoCompactionAttemptLeafId = deps.sessionTree.getLeafId();
      }
      if (deps.agent) {
        deps.agent.state.messages = deps.sessionTree.loadAgentMessages();
      }
      return true;
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

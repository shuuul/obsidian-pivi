import type { Agent, AgentMessage } from '@earendil-works/pi-agent-core';
import type { AssistantMessage } from '@earendil-works/pi-ai';

import type { StreamChunk } from '../../foundation';
import { toChatTurnRequestSnapshot } from '../../runtime/queuedTurn';
import type { PreparedChatTurn } from '../../runtime/types';
import type { PiAgentEventAdapter } from './piAgentEventAdapter';
import { runPiChatPromptWithRetry } from './piChatRetry';
import {
  type ActiveTurn,
  finishActiveTurnQueue,
  trackActiveTurnSubagentTool,
} from './piChatRuntimeActiveTurn';
import {
  attachContextEnvelope,
  compactCurrentSession,
  type PiChatCompactionDeps,
  prepareCompactionPrefire,
  prepareContextForTurn,
  pushCompactionChunks,
  shouldAutoCompactSession,
} from './piChatRuntimeCompaction';
import {
  buildEstimatedUsageInfo,
  buildUsageInfoFromAgentMessage,
  latestUsageFromMessages,
} from './piChatRuntimeUsage';
import { toPiImageContent } from './piImageContent';
import type { resolvePiModel } from './piModelEnv';
import type { SessionTreeStore } from './session/sessionTreeStore';

export interface PiChatRuntimeTurnDeps {
  activeTurn: ActiveTurn;
  agent: Agent;
  compaction: PiChatCompactionDeps;
  eventAdapter: PiAgentEventAdapter;
  sessionTree: SessionTreeStore | null;
  resolveModel: () => ReturnType<typeof resolvePiModel>;
  refreshModelMetadata: () => Promise<boolean>;
  syncSessionMessages: (messages: AgentMessage[]) => void;
  onUserMessagePersisted: (result: {
    parentEntryId: string | null;
    userEntryId: string;
    leafId: string | null;
  }) => void;
}

/**
 * Owns one prompt's Pi subscription, persistence, queue, and compaction lifecycle.
 * The runtime retains active-turn ownership so cancellation and subagent routing
 * remain coordinated across prompts.
 */
export async function* streamPiChatTurn(
  deps: PiChatRuntimeTurnDeps,
  turn: PreparedChatTurn,
): AsyncGenerator<StreamChunk> {
  const { activeTurn, agent } = deps;
  const emittedMessages: AgentMessage[] = [];

  const unsubscribe = agent.subscribe((event) => {
    if (event.type === 'message_end') {
      emittedMessages.push(event.message);
      const usage = buildUsageInfoFromAgentMessage(event.message, deps.resolveModel());
      if (usage) {
        activeTurn.queue.push({
          type: 'usage',
          usage: attachContextEnvelope(deps.compaction, usage, turn, emittedMessages),
        });
      } else if ((event.message as { role?: unknown }).role === 'toolResult') {
        const estimatedUsage = buildEstimatedUsageInfo(emittedMessages, deps.resolveModel());
        if (estimatedUsage) {
          activeTurn.queue.push({
            type: 'usage',
            usage: attachContextEnvelope(
              deps.compaction,
              estimatedUsage,
              turn,
              emittedMessages,
            ),
          });
        }
      }
      if (isAssistantErrorMessage(event.message)) {
        // Retry policy owns whether this is transient or terminal. Defer the
        // visible error until the prompt/continue cycle settles.
        return;
      }
    }
    if (event.type === 'agent_end') {
      // Persistence runs once after agent.prompt() resolves so a failed write
      // reaches the turn error path instead of becoming silent history loss.
      return;
    }
    if (
      event.type === 'message_update'
      && event.assistantMessageEvent.type === 'error'
    ) {
      // pi-agent-core normally reports the finalized error on message_end.
      // Suppress this safety-net event so a retryable attempt never renders as
      // a terminal error before the retry decision.
      return;
    }
    for (const chunk of deps.eventAdapter.adapt(event)) {
      trackActiveTurnSubagentTool(activeTurn, chunk);
      activeTurn.queue.push(chunk);
    }
  });

  const promptPromise = runPromptLifecycle(
    deps,
    turn,
    emittedMessages,
  ).catch((error: unknown) => {
    activeTurn.queue.push({
      type: 'error',
      content: error instanceof Error ? error.message : String(error),
    });
    finishActiveTurnQueue(activeTurn);
  });

  try {
    while (true) {
      const chunk = await activeTurn.queue.next();
      if (!chunk) {
        break;
      }
      yield chunk;
    }
    await promptPromise;
  } finally {
    unsubscribe();
    activeTurn.acceptingSubagentChunks = false;
  }
}

async function runPromptLifecycle(
  deps: PiChatRuntimeTurnDeps,
  turn: PreparedChatTurn,
  emittedMessages: AgentMessage[],
): Promise<void> {
  const { activeTurn, agent } = deps;
  const preflightCompacted = await prepareContextForTurn(
    deps.compaction,
    turn,
    activeTurn.queue,
  );
  if (preflightCompacted === null) {
    finishActiveTurnQueue(activeTurn);
    return;
  }
  const didCompactDuringTurn = preflightCompacted;

  persistUserMessage(deps, turn);

  const promptImages = toPiImageContent(turn.request.images);
  const retryResult = await runPiChatPromptWithRetry({
    agent,
    contextWindow: deps.resolveModel()?.contextWindow ?? 0,
    emit: (chunk) => activeTurn.queue.push(chunk),
    getLatestAssistantMessage: () => latestAssistantMessage(emittedMessages),
    persistFailedAttempt: () => deps.syncSessionMessages(emittedMessages),
    prompt: () => promptImages.length > 0
      ? agent.prompt(turn.prompt, promptImages)
      : agent.prompt(turn.prompt),
    signal: activeTurn.abortController.signal,
  });

  if (retryResult.status === 'failed' && retryResult.finalMessage) {
    activeTurn.queue.push(deps.eventAdapter.adaptAssistantError(
      retryResult.finalMessage as unknown as Record<string, unknown>,
    ));
  }
  if (retryResult.status === 'cancelled') {
    deps.syncSessionMessages(emittedMessages);
    finishActiveTurnQueue(activeTurn);
    return;
  }

  const refreshedModelMetadata = await deps.refreshModelMetadata();

  const finalMessages = emittedMessages.length > 0
    ? emittedMessages
    : agent.state.messages;
  deps.syncSessionMessages(finalMessages);
  const latestUsage = latestUsageFromMessages(finalMessages, deps.resolveModel());
  const usage = latestUsage
    ? attachContextEnvelope(deps.compaction, latestUsage, turn)
    : null;
  if (refreshedModelMetadata && usage) {
    // Replace the first turn's pre-load context estimate with the runtime
    // window discovered after the local server loaded the model.
    activeTurn.queue.push({ type: 'usage', usage });
  }
  if (!didCompactDuringTurn && usage && shouldAutoCompactSession(deps.compaction, usage)) {
    activeTurn.queue.push({ type: 'context_compacting' });
    try {
      const compacted = await compactCurrentSession(deps.compaction, 'threshold');
      if (compacted) {
        pushCompactionChunks(activeTurn.queue, deps.compaction, compacted, turn);
      }
    } catch (error) {
      activeTurn.queue.push({
        type: 'notice',
        level: 'warning',
        content: `Auto compaction failed: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  } else if (!didCompactDuringTurn && usage) {
    prepareCompactionPrefire(deps.compaction, usage);
  }
  finishActiveTurnQueue(activeTurn);
}

function isAssistantErrorMessage(message: AgentMessage): message is AssistantMessage {
  return message.role === 'assistant' && message.stopReason === 'error';
}

function latestAssistantMessage(
  messages: AgentMessage[],
): AssistantMessage | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === 'assistant') {
      return message;
    }
  }
  return undefined;
}

function persistUserMessage(
  deps: PiChatRuntimeTurnDeps,
  turn: PreparedChatTurn,
): void {
  if (!deps.sessionTree) {
    return;
  }
  try {
    const parentEntryId = deps.sessionTree.getLeafId();
    const userEntryId = deps.sessionTree.appendUserMessage(
      turn.persistedContent,
      turn.request.images,
    );
    deps.sessionTree.appendMessageUi({
      targetEntryId: userEntryId,
      displayContent: turn.displayContent,
      turnRequest: toChatTurnRequestSnapshot(turn.request),
    });
    deps.onUserMessagePersisted({
      parentEntryId,
      userEntryId,
      leafId: deps.sessionTree.getLeafId(),
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to persist user message before prompt: ${detail}`, { cause: error });
  }
}

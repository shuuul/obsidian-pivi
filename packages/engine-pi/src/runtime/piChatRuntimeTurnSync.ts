/** Session synchronization applied around a chat turn, and routing of subagent chunks to their owning turn. */

import type { AgentMessage } from '@earendil-works/pi-agent-core';
import type { StreamChunk } from '@pivi/agent/runtime';
import { extractTextContent } from '@pivi/agent/runtime/messageContent';
import { toChatTurnRequestSnapshot } from '@pivi/agent/runtime/queuedTurn';
import type { PreparedChatTurn } from '@pivi/agent/runtime/types';

import { type MissingAgentMessagesOptions } from '../session/agentMessageHistory';
import type { SessionTreeStore } from '../session/sessionTreeStore';
import { type ActiveTurn, getSubagentOwnerToolId } from './piChatRuntimeActiveTurn';

function buildTurnSyncOptions(
  turns?: PreparedChatTurn | readonly PreparedChatTurn[],
): MissingAgentMessagesOptions | undefined {
  const normalizedTurns: readonly PreparedChatTurn[] = turns
    ? Array.isArray(turns) ? turns as readonly PreparedChatTurn[] : [turns as PreparedChatTurn]
    : [];
  const userMessageEquivalences = normalizedTurns
    .filter(turn => turn.persistedContent !== turn.prompt)
    .map(turn => ({
      existingText: turn.persistedContent,
      incomingText: turn.prompt,
    }));
  if (userMessageEquivalences.length === 0) {
    return undefined;
  }
  return {
    userMessageEquivalences,
  };
}

export function syncSessionMessagesAfterTurn(
  sessionTree: SessionTreeStore | null,
  messages: AgentMessage[],
  turns: PreparedChatTurn | readonly PreparedChatTurn[] | undefined,
  onLeafIdChanged: (leafId: string | null) => void,
  onAssistantMessageId: (entryId: string | undefined) => void,
): void {
  if (!sessionTree || messages.length === 0) {
    return;
  }
  sessionTree.syncAgentMessages(messages, buildTurnSyncOptions(turns));
  onLeafIdChanged(sessionTree.getLeafId());
  onAssistantMessageId(
    sessionTree.findLastVisibleMessageEntryId('assistant') ?? undefined,
  );
}

/** Persist the next accepted steering turn once Pi's injected user message appears in the run. */
export function persistSteeredTurnBeforeSync(
  sessionTree: SessionTreeStore | null,
  activeTurn: ActiveTurn,
  messages: AgentMessage[],
): void {
  const turn = activeTurn.steeredTurns[activeTurn.persistedSteeredTurnCount];
  if (!turn || !sessionTree) {
    return;
  }
  const containsSteeredUserMessage = messages.some((message) => {
    if (message.role !== 'user') return false;
    const content = typeof message.content === 'string'
      ? message.content
      : extractTextContent(message.content);
    // Pi queues the exact AgentMessage passed to steer(); context transforms apply only
    // to the provider request. Keep this strict so an earlier similar turn cannot match.
    return content === turn.prompt;
  });
  if (!containsSteeredUserMessage) {
    return;
  }
  const targetEntryId = sessionTree.appendUserMessage(
    turn.persistedContent,
    turn.request.images,
  );
  sessionTree.appendMessageUi({
    targetEntryId,
    displayContent: turn.displayContent,
    turnRequest: toChatTurnRequestSnapshot(turn.request),
  });
  activeTurn.persistedSteeredTurnCount += 1;
}

/** Deliver a subagent chunk to the turn that owns its spawn tool call, else to runtime listeners. */
export function routeSubagentChunk(
  activeTurn: ActiveTurn | null,
  listeners: Iterable<(chunk: StreamChunk) => void | Promise<void>>,
  chunk: StreamChunk,
  onListenerError: (error: unknown) => void,
): void {
  const subagentToolId = getSubagentOwnerToolId(chunk);
  if (
    activeTurn?.acceptingSubagentChunks
    && subagentToolId
    && activeTurn.subagentToolIds.has(subagentToolId)
  ) {
    activeTurn.queue.push(chunk);
    return;
  }

  for (const listener of listeners) {
    Promise.resolve(listener(chunk)).catch(onListenerError);
  }
}

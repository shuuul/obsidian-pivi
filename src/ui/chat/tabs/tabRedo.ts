import { resolveUserMessageDisplayText } from '@pivi/pivi-agent-core/context/context';
import type { ChatMessage, ImageAttachment } from '@pivi/pivi-agent-core/foundation';
import {
  type ChatTurnRequest,
  chatTurnRequestFromSnapshot,
} from '@pivi/pivi-agent-core/runtime';
import type { ChatPorts } from '@pivi/pivi-agent-core/runtime/chatPorts';
import { Notice } from 'obsidian';

import type { PiviChatHost } from '@/app/hostContracts';
import { t } from '@/app/i18n';
import { TodoEventPresenter } from '@/ui/chat/stream/TodoEventPresenter';
import { confirm } from '@/ui/shared/modals/ConfirmModal';

import { findRedoContext } from '../branchContext';
import { initializeTabService } from './tabRuntime';
import type { TabData } from './types';

export interface RedoTurnContext {
  userIndex: number;
  assistantIndex: number;
  checkpointId: string | null;
  displayContent: string;
  turnRequest: ChatTurnRequest;
  images?: ImageAttachment[];
}

function cloneImages(images: ImageAttachment[] | undefined): ImageAttachment[] | undefined {
  return images && images.length > 0 ? [...images] : undefined;
}

function buildRedoTurnRequest(userMessage: ChatMessage): ChatTurnRequest {
  if (userMessage.turnRequest) {
    return chatTurnRequestFromSnapshot(userMessage.turnRequest, userMessage.images);
  }
  return {
    text: userMessage.content,
    images: cloneImages(userMessage.images),
  };
}

export function resolveRedoTurnContext(
  messages: ChatMessage[],
  assistantMessageId: string,
): RedoTurnContext | null {
  const assistantIndex = messages.findIndex(message => message.id === assistantMessageId);
  const redoContext = findRedoContext(messages, assistantIndex);
  if (!redoContext) {
    return null;
  }

  const userMessage = messages[redoContext.userIndex];
  if (!userMessage || userMessage.role !== 'user') {
    return null;
  }

  return {
    userIndex: redoContext.userIndex,
    assistantIndex,
    checkpointId: redoContext.checkpointId,
    displayContent: resolveUserMessageDisplayText(userMessage),
    turnRequest: buildRedoTurnRequest(userMessage),
    images: cloneImages(userMessage.images),
  };
}

function restoreTruncatedMessages(tab: TabData, messages: ChatMessage[]): void {
  tab.controllers.streamController?.resetStreamingState();
  tab.services.subagentManager.orphanAllActive();
  tab.services.subagentManager.clear();

  tab.state.messages = messages;
  tab.state.usage = null;
  tab.state.currentTodos = null;
  tab.state.clearMaps();
  new TodoEventPresenter(tab.state).restoreFromMessages(messages);

}

function countMessagesAfterTargetAssistant(messages: ChatMessage[], assistantIndex: number): number {
  return Math.max(0, messages.length - assistantIndex - 1);
}

export async function handleRedoRequest(
  tab: TabData,
  plugin: PiviChatHost,
  ports: ChatPorts,
  assistantMessageId: string,
): Promise<void> {
  const { state } = tab;

  if (state.isStreaming) {
    new Notice(t('chat.redo.unavailableStreaming'));
    return;
  }

  const redoTurn = resolveRedoTurnContext(state.messages, assistantMessageId);
  if (!redoTurn) {
    new Notice(t('chat.redo.unavailableNoTurn'));
    return;
  }

  if (!tab.controllers.inputController || !tab.controllers.openSessionController) {
    new Notice(t('chat.redo.unavailableRuntime'));
    return;
  }

  if (countMessagesAfterTargetAssistant(state.messages, redoTurn.assistantIndex) > 0) {
    const confirmed = await confirm(
      plugin.app,
      t('chat.redo.confirmTruncate'),
      t('chat.redo.confirmTruncateAction'),
    );
    if (!confirmed) {
      return;
    }
  }

  await initializeTabService(tab, ports);
  const service = tab.service;
  if (!service) {
    new Notice(t('chat.redo.unavailableRuntime'));
    return;
  }

  const rewind = await service.rewind(redoTurn.checkpointId);
  if (!rewind.canRewind) {
    new Notice(t('chat.redo.failed', { error: rewind.error ?? t('chat.redo.unavailableRewind') }));
    return;
  }

  tab.leafId = rewind.leafId ?? null;
  const remainingMessages = state.messages.slice(0, redoTurn.userIndex);
  restoreTruncatedMessages(tab, remainingMessages);
  await tab.controllers.openSessionController.save(false);

  await tab.controllers.inputController.sendMessage({
    content: redoTurn.displayContent,
    images: redoTurn.images,
    turnRequestOverride: redoTurn.turnRequest,
  });
}

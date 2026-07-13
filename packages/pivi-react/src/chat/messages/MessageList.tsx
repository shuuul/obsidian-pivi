import type { ChatMessage } from '@pivi/pivi-agent-core/foundation';

import { MessageView } from './MessageView';
import type { MessageContentAdapters, MessagePresentationActions } from './types';

export interface MessageListProps {
  readonly messages: readonly ChatMessage[];
  readonly isStreaming: boolean;
  readonly actions: MessagePresentationActions;
  readonly contentAdapters?: MessageContentAdapters;
}

function findStreamingTurnStart(messages: readonly ChatMessage[]): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === 'user' && !message.isRebuiltContext) return index;
  }
  return messages.length;
}

/** Snapshot-driven presentation list. Content-block order remains delegated to AssistantContentView. */
export function MessageList({ actions, contentAdapters, isStreaming, messages }: MessageListProps) {
  const streamingTurnStart = isStreaming ? findStreamingTurnStart(messages) : messages.length;
  return (
    <div className="pivi-message-list">
      {messages.map((message, index) => (
        <MessageView
          actions={actions}
          contentAdapters={contentAdapters}
          hideActions={index >= streamingTurnStart}
          key={message.id}
          message={message}
        />
      ))}
    </div>
  );
}

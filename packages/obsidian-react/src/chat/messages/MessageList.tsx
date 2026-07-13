import type { ChatMessage } from '@pivi/pivi-agent-core/foundation';

import { MessageView } from './MessageView';
import type { MessageContentAdapters, MessagePresentationActions } from './types';

export interface MessageListProps {
  readonly messages: readonly ChatMessage[];
  readonly actions: MessagePresentationActions;
  readonly contentAdapters?: MessageContentAdapters;
}

/** Snapshot-driven presentation list. Content-block order remains delegated to AssistantContentView. */
export function MessageList({ actions, contentAdapters, messages }: MessageListProps) {
  return (
    <div className="pivi-message-list">
      {messages.map(message => <MessageView actions={actions} contentAdapters={contentAdapters} key={message.id} message={message} />)}
    </div>
  );
}

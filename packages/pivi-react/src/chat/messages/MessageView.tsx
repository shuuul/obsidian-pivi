import type { ChatMessage, ImageAttachment } from '@pivi/pivi-agent-core/foundation';
import { useEffect, useRef, useState } from 'react';

import { useT } from '../../i18n';
import { PlatformIcon } from '../../icons';
import {
  AssistantContentView,
  isAssistantToolOnlyMessage,
  messageHasVisibleAssistantContent,
} from './AssistantContentView';
import type { MessageContentAdapter, MessageContentAdapters, MessagePresentationActions } from './types';

const COPY_FEEDBACK_MS = 1500;

function AdapterSlot({ adapter, message }: {
  adapter: MessageContentAdapter<ChatMessage>;
  message: ChatMessage;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const container = ref.current;
    if (!container) return;
    const ownerWindow = container.ownerDocument.defaultView;
    if (!ownerWindow) return;
    return adapter.mount(container, message, {
      generation: message.id,
      ownerDocument: container.ownerDocument,
      ownerWindow,
    });
  }, [adapter, message]);
  return <div className="pivi-message-adapter-slot" ref={ref} />;
}

function MessageImages({ images }: { readonly images: readonly ImageAttachment[] }) {
  const [activeImage, setActiveImage] = useState<ImageAttachment | null>(null);
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!activeImage) return;
    const ownerDocument = overlayRef.current?.ownerDocument ?? document;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setActiveImage(null);
    };
    ownerDocument.addEventListener('keydown', onKeyDown);
    return () => ownerDocument.removeEventListener('keydown', onKeyDown);
  }, [activeImage]);

  return (
    <>
      <div className="pivi-message-images">
        {images.map(image => (
          <div className="pivi-message-image" key={image.id}>
            <img
              alt={image.name}
              onClick={() => setActiveImage(image)}
              src={`data:${image.mediaType};base64,${image.data}`}
            />
          </div>
        ))}
      </div>
      {activeImage ? (
        <div
          className="pivi-image-modal-overlay"
          onClick={event => {
            if (event.target === event.currentTarget) setActiveImage(null);
          }}
          ref={overlayRef}
        >
          <div className="pivi-image-modal">
            <img
              alt={activeImage.name}
              src={`data:${activeImage.mediaType};base64,${activeImage.data}`}
            />
            <div className="pivi-image-modal-close" onClick={() => setActiveImage(null)}>
              ×
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

function InterruptIndicator() {
  const t = useT();
  return (
    <div className="pivi-text-block">
      <span className="pivi-interrupted">{t('chat.stream.interrupted')}</span>
      {' '}
      <span className="pivi-interrupted-hint">{t('chat.stream.interruptHint')}</span>
    </div>
  );
}

function UserContent({ contentAdapters, message }: { contentAdapters?: MessageContentAdapters; message: ChatMessage }) {
  const content = message.displayContent ?? message.content;
  if (!content && !message.images?.length) return null;
  return (
    <>
      {message.images?.length ? <MessageImages images={message.images} /> : null}
      {content
        ? contentAdapters?.userContent
          ? <AdapterSlot adapter={contentAdapters.userContent} message={message} />
          : <div className="pivi-text-block">{content}</div>
        : null}
    </>
  );
}

function MessageCopyButton({
  message,
  onCopy,
}: {
  message: ChatMessage;
  onCopy: (message: ChatMessage) => void | Promise<void>;
}) {
  const t = useT();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const ownerWindow = buttonRef.current?.ownerDocument.defaultView ?? window;
    const timeout = ownerWindow.setTimeout(() => setCopied(false), COPY_FEEDBACK_MS);
    return () => ownerWindow.clearTimeout(timeout);
  }, [copied]);

  const roleClass = message.role === 'user'
    ? 'pivi-user-msg-copy-btn'
    : 'pivi-assistant-msg-copy-btn';
  const ariaLabel = message.role === 'assistant'
    ? t('chat.messageActions.copyAgentResponseAriaLabel')
    : t('chat.messageActions.copyAriaLabel');

  return (
    <button
      aria-label={ariaLabel}
      className={`pivi-message-action-btn pivi-message-copy-btn ${roleClass}${copied ? ' copied' : ''}`}
      onClick={() => {
        void Promise.resolve(onCopy(message)).then(() => setCopied(true));
      }}
      ref={buttonRef}
      type="button"
    >
      <PlatformIcon name={copied ? 'check' : 'copy'} />
    </button>
  );
}

export interface MessageViewProps {
  readonly message: ChatMessage;
  readonly actions: MessagePresentationActions;
  readonly contentAdapters?: MessageContentAdapters;
  readonly hideActions?: boolean;
}

/** The sole React owner of a visible message shell and its action toolbar. */
export function MessageView({ actions, contentAdapters, hideActions = false, message }: MessageViewProps) {
  const t = useT();
  if (message.isRebuiltContext) return null;

  const hasVisibleAssistant = message.role === 'assistant' && messageHasVisibleAssistantContent(message);
  // HEAD: interrupt user messages, and interrupt assistants with no visible content, render as
  // an assistant shell that only contains the interrupt indicator.
  if (message.isInterrupt && (message.role === 'user' || !hasVisibleAssistant)) {
    return (
      <article className="pivi-message pivi-message-assistant" data-message-id={message.id} data-role="assistant">
        <div className="pivi-message-content" dir="auto">
          <InterruptIndicator />
        </div>
      </article>
    );
  }

  if (message.role === 'assistant' && !hasVisibleAssistant) return null;

  const canCopy = !hideActions && actions.canCopy(message);
  const showScroll = !hideActions && message.role === 'assistant';
  const showRedo = !hideActions && message.role === 'assistant' && actions.canRedo(message.id);
  const showFork = !hideActions && message.role === 'assistant' && actions.canFork(message);
  const showActions = canCopy || showScroll || showRedo || showFork;
  const roleActionsClass = message.role === 'user'
    ? 'pivi-user-msg-actions'
    : 'pivi-assistant-msg-actions';
  const toolOnlyClass = message.role === 'assistant' && isAssistantToolOnlyMessage(message)
    ? ' pivi-message-assistant-tool-only'
    : '';

  return (
    <article
      className={`pivi-message pivi-message-${message.role}${toolOnlyClass}`}
      data-message-id={message.id}
      data-role={message.role}
    >
      <div className="pivi-message-content" dir="auto">
        {message.role === 'user'
          ? <UserContent contentAdapters={contentAdapters} message={message} />
          : (
            <>
              <AssistantContentView contentAdapters={contentAdapters} message={message} />
              {message.isInterrupt ? <InterruptIndicator /> : null}
            </>
          )}
      </div>
      {showActions ? (
        <div className={`pivi-message-actions ${roleActionsClass}`}>
          {canCopy
            ? <MessageCopyButton message={message} onCopy={actions.copy} />
            : null}
          {showScroll
            ? (
              <button
                aria-label={t('chat.messageActions.scrollToRecentUserAriaLabel')}
                className="pivi-message-action-btn pivi-message-scroll-user-btn"
                onClick={actions.scrollToRecentUser}
                type="button"
              >
                <PlatformIcon name="user" />
              </button>
            )
            : null}
          {showRedo
            ? (
              <button
                aria-label={t('chat.redo.ariaLabel')}
                className="pivi-message-action-btn pivi-message-redo-btn"
                onClick={() => void actions.redo(message.id)}
                type="button"
              >
                <PlatformIcon name="refresh-cw" />
              </button>
            )
            : null}
          {showFork
            ? (
              <button
                aria-label={t('chat.fork.ariaLabel')}
                className="pivi-message-action-btn pivi-message-fork-btn"
                onClick={() => void actions.fork(message.id)}
                type="button"
              >
                <PlatformIcon name="git-fork" />
              </button>
            )
            : null}
        </div>
      ) : null}
    </article>
  );
}

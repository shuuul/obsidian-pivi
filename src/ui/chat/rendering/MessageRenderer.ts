import { resolveUserMessageDisplayText } from '@pivi/pivi-agent-core/context/context';
import type { ChatMessage, ImageAttachment } from '@pivi/pivi-agent-core/foundation';
import type { App, Component } from 'obsidian';

import type PiviPlugin from '@/app/PiviPluginHost';
import { t } from '@/i18n';

import { registerFileLinkHandler } from '../../shared/utils/fileLink';
import {
  type MessageRendererActionsHost,
  refreshMessageActions,
} from './messageRendererActions';
import {
  messageHasVisibleAssistantContent,
  renderAssistantContent,
} from './messageRendererAssistant';
import {
  type MessageRendererMarkdownHost,
  renderMarkdownContent,
  renderUserMessageText,
} from './messageRendererMarkdown';
import type { RenderContentOptions } from './messageRendererTypes';

export type { RenderContentFn, RenderContentOptions } from './messageRendererTypes';

export class MessageRenderer implements MessageRendererMarkdownHost, MessageRendererActionsHost {
  readonly app: App;
  readonly plugin: PiviPlugin;
  readonly component: Component;
  messagesEl: HTMLElement;
  forkCallback?: (messageId: string) => Promise<void>;
  private liveMessageEls = new Map<string, HTMLElement>();

  constructor(
    plugin: PiviPlugin,
    component: Component,
    messagesEl: HTMLElement,
    forkCallback?: (messageId: string) => Promise<void>,
  ) {
    this.app = plugin.app;
    this.plugin = plugin;
    this.component = component;
    this.messagesEl = messagesEl;
    this.forkCallback = forkCallback;

    registerFileLinkHandler(this.app, this.messagesEl, this.component);
  }

  setMessagesEl(el: HTMLElement): void {
    this.messagesEl = el;
  }

  addMessage(msg: ChatMessage): HTMLElement {
    if (msg.role === 'user' && msg.images && msg.images.length > 0) {
      this.renderMessageImages(this.messagesEl, msg.images);
    }

    if (msg.role === 'user') {
      const textToShow = resolveUserMessageDisplayText(msg);
      if (!textToShow) {
        this.scrollToBottom();
        const lastChild = this.messagesEl.lastElementChild;
        if (lastChild instanceof HTMLElement) {
          return lastChild;
        }
        return this.messagesEl;
      }
    }

    const msgEl = this.messagesEl.createDiv({
      cls: `pivi-message pivi-message-${msg.role}`,
      attr: {
        'data-message-id': msg.id,
        'data-role': msg.role,
      },
    });

    const contentEl = msgEl.createDiv({ cls: 'pivi-message-content', attr: { dir: 'auto' } });

    if (msg.role === 'user') {
      const textToShow = resolveUserMessageDisplayText(msg);
      if (textToShow) {
        const textEl = contentEl.createDiv({ cls: 'pivi-text-block' });
        void this.renderUserMessageText(textEl, textToShow);
      }
      refreshMessageActions(this, msgEl, msg);
    }

    if (this.forkCallback) {
      this.liveMessageEls.set(msg.id, msgEl);
    }

    this.scrollToBottom();
    return msgEl;
  }

  updateLiveUserMessage(msg: ChatMessage): void {
    if (msg.role !== 'user') {
      return;
    }

    const msgEl = this.liveMessageEls.get(msg.id)
      ?? this.messagesEl.querySelector<HTMLElement>(`[data-message-id="${msg.id}"]`);
    if (!msgEl) {
      return;
    }

    const contentEl = msgEl.querySelector<HTMLElement>('.pivi-message-content');
    if (!contentEl) {
      return;
    }

    contentEl.empty();

    const textToShow = resolveUserMessageDisplayText(msg);
    if (textToShow) {
      const textEl = contentEl.createDiv({ cls: 'pivi-text-block' });
      void this.renderUserMessageText(textEl, textToShow);
    }

    refreshMessageActions(this, msgEl, msg);
  }

  removeMessage(messageId: string): void {
    const msgEl = this.liveMessageEls.get(messageId)
      ?? this.messagesEl.querySelector<HTMLElement>(`[data-message-id="${messageId}"]`);
    if (!msgEl) {
      return;
    }

    msgEl.remove();
    this.liveMessageEls.delete(messageId);
  }

  renderMessages(
    messages: ChatMessage[],
    getGreeting: () => string,
  ): HTMLElement {
    this.messagesEl.empty();
    this.liveMessageEls.clear();

    const newWelcomeEl = this.messagesEl.createDiv({ cls: 'pivi-welcome' });
    newWelcomeEl.createDiv({ cls: 'pivi-welcome-greeting', text: getGreeting() });

    for (let i = 0; i < messages.length; i++) {
      this.renderStoredMessage(messages[i], messages, i);
    }

    this.scrollToBottom();
    return newWelcomeEl;
  }

  renderStoredMessage(msg: ChatMessage, allMessages?: ChatMessage[], index?: number): void {
    if (msg.isInterrupt && (msg.role === 'user' || !this.hasVisibleContent(msg))) {
      this.renderInterruptMessage();
      return;
    }

    if (msg.isRebuiltContext) {
      return;
    }

    if (msg.role === 'user' && msg.images && msg.images.length > 0) {
      this.renderMessageImages(this.messagesEl, msg.images);
    }

    if (msg.role === 'user') {
      if (!resolveUserMessageDisplayText(msg)) {
        return;
      }
    }
    if (msg.role === 'assistant' && !this.hasVisibleContent(msg)) {
      return;
    }

    const msgEl = this.messagesEl.createDiv({
      cls: `pivi-message pivi-message-${msg.role}`,
      attr: {
        'data-message-id': msg.id,
        'data-role': msg.role,
      },
    });

    const contentEl = msgEl.createDiv({ cls: 'pivi-message-content', attr: { dir: 'auto' } });

    if (msg.role === 'user') {
      const textToShow = resolveUserMessageDisplayText(msg);
      if (textToShow) {
        const textEl = contentEl.createDiv({ cls: 'pivi-text-block' });
        void this.renderUserMessageText(textEl, textToShow);
      }
      refreshMessageActions(this, msgEl, msg);
    } else if (msg.role === 'assistant') {
      renderAssistantContent(this, msg, contentEl);
      if (msg.isInterrupt) {
        this.appendInterruptIndicator(contentEl);
      }
      refreshMessageActions(this, msgEl, msg);
    }

    void allMessages;
    void index;
  }

  private hasVisibleContent(msg: ChatMessage): boolean {
    return messageHasVisibleAssistantContent(msg);
  }

  private renderInterruptMessage(): void {
    const msgEl = this.messagesEl.createDiv({ cls: 'pivi-message pivi-message-assistant' });
    const contentEl = msgEl.createDiv({ cls: 'pivi-message-content', attr: { dir: 'auto' } });
    this.appendInterruptIndicator(contentEl);
  }

  private appendInterruptIndicator(contentEl: HTMLElement): void {
    const textEl = contentEl.createDiv({ cls: 'pivi-text-block' });
    textEl.createSpan({ cls: 'pivi-interrupted', text: t('chat.stream.interrupted') });
    textEl.appendText(' ');
    textEl.createSpan({
      cls: 'pivi-interrupted-hint',
      text: t('chat.stream.interruptHint'),
    });
  }

  renderMessageImages(containerEl: HTMLElement, images: ImageAttachment[]): void {
    const imagesEl = containerEl.createDiv({ cls: 'pivi-message-images' });

    for (const image of images) {
      const imageWrapper = imagesEl.createDiv({ cls: 'pivi-message-image' });
      const imgEl = imageWrapper.createEl('img', {
        attr: {
          alt: image.name,
        },
      });

      void this.setImageSrc(imgEl, image);

      imgEl.addEventListener('click', () => {
        void this.showFullImage(image);
      });
    }
  }

  showFullImage(image: ImageAttachment): void {
    const dataUri = `data:${image.mediaType};base64,${image.data}`;

    const ownerDocument = this.messagesEl.ownerDocument ?? window.document;
    const overlay = ownerDocument.body.createDiv({ cls: 'pivi-image-modal-overlay' });
    const modal = overlay.createDiv({ cls: 'pivi-image-modal' });

    modal.createEl('img', {
      attr: {
        src: dataUri,
        alt: image.name,
      },
    });

    const closeBtn = modal.createDiv({ cls: 'pivi-image-modal-close' });
    closeBtn.setText('\u00D7');

    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        close();
      }
    };

    const close = () => {
      ownerDocument.removeEventListener('keydown', handleEsc);
      overlay.remove();
    };

    closeBtn.addEventListener('click', close);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close();
    });
    ownerDocument.addEventListener('keydown', handleEsc);
  }

  setImageSrc(imgEl: HTMLImageElement, image: ImageAttachment): void {
    const dataUri = `data:${image.mediaType};base64,${image.data}`;
    imgEl.setAttribute('src', dataUri);
  }

  private async renderUserMessageText(el: HTMLElement, text: string): Promise<void> {
    await renderUserMessageText(this, el, text, (target, markdown, options) => this.renderContent(target, markdown, options));
  }

  async renderContent(
    el: HTMLElement,
    markdown: string,
    options?: RenderContentOptions,
  ): Promise<void> {
    await renderMarkdownContent(this, el, markdown, options);
  }

  refreshActionButtons(msg: ChatMessage, allMessages?: ChatMessage[], index?: number): void {
    const msgEl = this.liveMessageEls.get(msg.id)
      ?? this.messagesEl.querySelector<HTMLElement>(`[data-message-id="${msg.id}"]`);
    if (!msgEl) return;

    refreshMessageActions(this, msgEl, msg);
    this.liveMessageEls.delete(msg.id);

    void allMessages;
    void index;
  }

  scrollToBottom(): void {
    this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
  }

  scrollToBottomIfNeeded(threshold = 100): void {
    const { scrollTop, scrollHeight, clientHeight } = this.messagesEl;
    const isNearBottom = scrollHeight - scrollTop - clientHeight < threshold;
    if (isNearBottom) {
      window.requestAnimationFrame(() => {
        this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
      });
    }
  }
}
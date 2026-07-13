import type { ChatPorts } from '@pivi/obsidian-ui/ports';
import type { ChatMessage } from '@pivi/pivi-agent-core/foundation';
import type { App, Component } from 'obsidian';

import type { PiviChatHost } from '@/app/hostContracts';

import { registerFileLinkHandler } from '../../shared/utils/fileLink';
import {
  type MessageRendererMarkdownHost,
  renderMarkdownContent,
  renderUserMessageText,
} from './messageRendererMarkdown';
import type { RenderContentOptions } from './messageRendererTypes';

export type { RenderContentFn, RenderContentOptions } from './messageRendererTypes';

export class MessageRenderer implements MessageRendererMarkdownHost {
  readonly app: App;
  readonly plugin: PiviChatHost;
  readonly ports: ChatPorts;
  readonly component: Component;
  messagesEl: HTMLElement;
  forkCallback?: (messageId: string) => Promise<void>;
  redoCallback?: (messageId: string) => Promise<void>;

  constructor(
    plugin: PiviChatHost,
    component: Component,
    messagesEl: HTMLElement,
    ports: ChatPorts,
    forkCallback?: (messageId: string) => Promise<void>,
    redoCallback?: (messageId: string) => Promise<void>,
  ) {
    this.app = plugin.app;
    this.plugin = plugin;
    this.ports = ports;
    this.component = component;
    this.messagesEl = messagesEl;
    this.forkCallback = forkCallback;
    this.redoCallback = redoCallback;

    registerFileLinkHandler(this.app, this.messagesEl, this.component);
  }

  setMessagesEl(el: HTMLElement): void {
    this.messagesEl = el;
  }



  async renderUserMessageText(
    el: HTMLElement,
    text: string,
    turnRequest: ChatMessage['turnRequest'],
  ): Promise<void> {
    await renderUserMessageText(
      this,
      el,
      text,
      turnRequest,
      (target, markdown, options) => this.renderContent(target, markdown, options),
    );
  }

  async renderContent(
    el: HTMLElement,
    markdown: string,
    options?: RenderContentOptions,
  ): Promise<void> {
    await renderMarkdownContent(this, el, markdown, options);
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

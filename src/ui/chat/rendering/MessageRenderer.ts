import type { ChatMessage } from '@pivi/pivi-agent-core/foundation';
import type { ChatPorts } from '@pivi/pivi-agent-core/runtime/chatPorts';
import type { App, Component } from 'obsidian';

import type { PiviChatHost } from '@/app/hostContracts';

import { getActiveWindow } from '../../shared/dom';
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
  scrollToBottomIfNeeded(threshold = 100): void {
    const { scrollTop, scrollHeight, clientHeight } = this.messagesEl;
    const isNearBottom = scrollHeight - scrollTop - clientHeight < threshold;
    if (isNearBottom) {
      getActiveWindow(this.messagesEl).requestAnimationFrame(() => {
        this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
      });
    }
  }
}

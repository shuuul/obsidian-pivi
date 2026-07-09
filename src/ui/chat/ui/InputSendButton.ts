import { setIcon } from 'obsidian';

import { t } from '@/i18n';

import type { RichChatInput } from './RichChatInput';

export type InputSendButtonState = 'ready' | 'streaming' | 'disabled';

export interface InputSendButtonDeps {
  getInputEl: () => RichChatInput;
  getIsStreaming: () => boolean;
  onSend: () => void;
  onStop: () => void;
}

export class InputSendButton {
  private buttonEl: HTMLButtonElement;
  private deps: InputSendButtonDeps;

  constructor(parentEl: HTMLElement, deps: InputSendButtonDeps) {
    this.deps = deps;
    const wrap = parentEl.createDiv({ cls: 'pivi-send-button-wrap' });
    this.buttonEl = wrap.createEl('button', {
      cls: 'pivi-send-button pivi-send-disabled',
      attr: { type: 'button', 'aria-label': t('chat.composer.sendAria') },
    });
    this.buttonEl.addEventListener('click', () => this.handleClick());
    this.update();
  }

  destroy(): void {
    this.buttonEl.parentElement?.remove();
  }

  update(): void {
    const state = this.resolveState();
    this.buttonEl.removeClass('pivi-send-ready', 'pivi-send-streaming', 'pivi-send-disabled');
    this.buttonEl.addClass(`pivi-send-${state}`);

    const icon = state === 'streaming' ? 'square' : 'arrow-up';
    setIcon(this.buttonEl, icon);

    if (state === 'streaming') {
      this.buttonEl.disabled = false;
      this.buttonEl.setAttr('aria-label', t('chat.composer.stopAria'));
      this.buttonEl.setAttr('title', t('chat.composer.stopTitle'));
      return;
    }

    const hasContent = this.deps.getInputEl().value.trim().length > 0;
    this.buttonEl.disabled = state === 'disabled';
    this.buttonEl.setAttr('aria-label', hasContent ? t('chat.composer.sendAria') : t('chat.composer.sendEmptyAria'));
    this.buttonEl.setAttr('title', hasContent ? t('chat.composer.sendTitle') : t('chat.composer.sendEmptyTitle'));
  }

  private resolveState(): InputSendButtonState {
    if (this.deps.getIsStreaming()) {
      return 'streaming';
    }
    return this.deps.getInputEl().value.trim().length > 0 ? 'ready' : 'disabled';
  }

  private handleClick(): void {
    if (this.deps.getIsStreaming()) {
      this.deps.onStop();
      return;
    }
    if (this.deps.getInputEl().value.trim().length === 0) {
      return;
    }
    this.deps.onSend();
  }
}

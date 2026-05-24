import { setIcon } from 'obsidian';

export type InputSendButtonState = 'ready' | 'streaming' | 'disabled';

export interface InputSendButtonDeps {
  getInputEl: () => import('./RichChatInput').RichChatInput;
  getIsStreaming: () => boolean;
  onSend: () => void;
  onStop: () => void;
}

export class InputSendButton {
  private buttonEl: HTMLButtonElement;
  private deps: InputSendButtonDeps;

  constructor(parentEl: HTMLElement, deps: InputSendButtonDeps) {
    this.deps = deps;
    const wrap = parentEl.createDiv({ cls: 'obsius2-send-button-wrap' });
    this.buttonEl = wrap.createEl('button', {
      cls: 'obsius2-send-button obsius2-send-disabled',
      attr: { type: 'button', 'aria-label': 'Send message' },
    });
    this.buttonEl.addEventListener('click', () => this.handleClick());
    this.update();
  }

  destroy(): void {
    this.buttonEl.parentElement?.remove();
  }

  update(): void {
    const state = this.resolveState();
    this.buttonEl.removeClass('obsius2-send-ready', 'obsius2-send-streaming', 'obsius2-send-disabled');
    this.buttonEl.addClass(`obsius2-send-${state}`);

    const icon = state === 'streaming' ? 'square' : 'arrow-up';
    setIcon(this.buttonEl, icon);

    if (state === 'streaming') {
      this.buttonEl.disabled = false;
      this.buttonEl.setAttr('aria-label', 'Stop response');
      this.buttonEl.setAttr('title', 'Stop');
      return;
    }

    const hasContent = this.deps.getInputEl().value.trim().length > 0;
    this.buttonEl.disabled = state === 'disabled';
    this.buttonEl.setAttr('aria-label', hasContent ? 'Send message' : 'Enter a message to send');
    this.buttonEl.setAttr('title', hasContent ? 'Send' : 'Enter a message');
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

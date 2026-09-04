import type { RichChatInput } from '../input/RichChatInput';

export interface NavigationControllerDeps {
  getMessagesEl: () => HTMLElement;
  getInputEl: () => RichChatInput;
  isStreaming: () => boolean;
  /** Returns true if a UI component (dropdown, modal, mode) should handle Escape instead. */
  shouldSkipEscapeHandling?: () => boolean;
}

export class NavigationController {
  private deps: NavigationControllerDeps;
  private initialized = false;
  private disposed = false;

  private boundInputKeydown: (e: KeyboardEvent) => void;

  constructor(deps: NavigationControllerDeps) {
    this.deps = deps;
    this.boundInputKeydown = (e) => this.handleInputKeydown(e);
  }

  initialize(): void {
    if (this.initialized || this.disposed) return;

    const messagesEl = this.deps.getMessagesEl();
    const inputEl = this.deps.getInputEl();

    if (!messagesEl || !inputEl) return;

    messagesEl.setAttribute('tabindex', '0');
    messagesEl.addClass('pivi-messages-focusable');

    inputEl.addEventListener('keydown', this.boundInputKeydown as EventListener, { capture: true });

    this.initialized = true;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    const messagesEl = this.deps.getMessagesEl();
    messagesEl?.removeClass('pivi-messages-focusable');

    const inputEl = this.deps.getInputEl();
    inputEl?.removeEventListener('keydown', this.boundInputKeydown as EventListener, { capture: true });
  }

  private handleInputKeydown(e: KeyboardEvent): void {
    if (e.key !== 'Escape') return;
    if (e.isComposing) return;
    if (this.deps.isStreaming()) return;
    if (this.deps.shouldSkipEscapeHandling?.()) return;

    e.preventDefault();
    e.stopPropagation();
    this.deps.getInputEl().blur();
    this.deps.getMessagesEl().focus();
  }

  focusMessages(): void {
    this.deps.getMessagesEl().focus();
  }

  focusInput(): void {
    this.deps.getInputEl().focus();
  }
}

interface InlineEditKeyboardControllerDeps {
  isDiffReview: () => boolean;
  isInputFocused: () => boolean;
  handleSlashKeydown: (event: KeyboardEvent) => boolean;
  handleMentionKeydown: (event: KeyboardEvent) => boolean;
  canSend: () => boolean;
  onSend: () => void;
  onAccept: () => void;
  onReject: () => void;
}

/** Owns owner-realm keyboard shortcuts for one inline-edit surface. */
export class InlineEditKeyboardController {
  private readonly handler = (event: KeyboardEvent): void => {
    if (this.deps.isDiffReview()) {
      const acceptsDiff = event.key === 'Enter' && (event.metaKey || event.ctrlKey);
      const rejectsDiff = event.key === 'Escape';
      if (!acceptsDiff && !rejectsDiff) return;
      event.preventDefault();
      event.stopPropagation();
      if (acceptsDiff) this.deps.onAccept();
      else this.deps.onReject();
      return;
    }
    if (!this.deps.isInputFocused()) return;
    if (this.deps.handleSlashKeydown(event) || this.deps.handleMentionKeydown(event)) return;
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && this.deps.canSend()) {
      event.preventDefault();
      this.deps.onSend();
    }
  };

  constructor(
    private readonly ownerWindow: Window,
    private readonly deps: InlineEditKeyboardControllerDeps,
  ) {
    ownerWindow.addEventListener('keydown', this.handler, { capture: true });
  }

  destroy(): void {
    this.ownerWindow.removeEventListener('keydown', this.handler, { capture: true });
  }
}

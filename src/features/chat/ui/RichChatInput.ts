import type { ComposerInput } from '../../../shared/mention/composerInputTypes';
import {
  buildComposerFromText,
  extractComposerContent,
  insertPlainTextAtSelection,
  setComposerCursor,
  shouldSyncMentionBadgesOnInput,
} from '../../../shared/mention/inlineMentionBadgeDom';
import type { MentionBadgeParseContext } from '../../../shared/mention/mentionBadgeTypes';
import { parseMessageMentions } from '../../../shared/mention/parseMessageMentions';

export type { ComposerInput };

export interface RichChatInputOptions {
  placeholder?: string;
  className?: string;
  getMentionContext: () => MentionBadgeParseContext;
}

/**
 * Contenteditable composer with inline mention badges (textarea-compatible API).
 */
export class RichChatInput implements ComposerInput {
  readonly el: HTMLDivElement;

  private getMentionContext: () => MentionBadgeParseContext;

  setMentionContextGetter(getter: () => MentionBadgeParseContext): void {
    this.getMentionContext = getter;
  }
  private isSyncing = false;
  private isComposing = false;
  private compositionSyncTimer: number | null = null;

  constructor(parent: HTMLElement, options: RichChatInputOptions) {
    this.getMentionContext = options.getMentionContext;

    this.el = parent.createDiv({
      cls: ['obsius2-input', 'obsius2-rich-input', 'obsius2-rich-input-empty', options.className].filter(Boolean).join(' '),
      attr: {
        contenteditable: 'true',
        role: 'textbox',
        'aria-multiline': 'true',
        'data-placeholder': options.placeholder ?? '',
      },
    });

    this.el.appendChild(activeDocument.createTextNode(''));
    this.el.addEventListener('input', () => this.onEditorInput());
    this.el.addEventListener('compositionstart', () => {
      this.isComposing = true;
      this.clearCompositionSyncTimer();
    });
    this.el.addEventListener('compositionend', () => {
      this.isComposing = false;
      this.scheduleMentionSyncAfterComposition();
    });
  }

  destroy(): void {
    this.clearCompositionSyncTimer();
    this.el.remove();
  }

  get value(): string {
    return extractComposerContent(this.el).text;
  }

  set value(text: string) {
    this.isSyncing = true;
    try {
      buildComposerFromText(this.el, text, this.getMentionContext());
      this.updateEmptyState();
    } finally {
      this.isSyncing = false;
    }
  }

  get selectionStart(): number {
    return extractComposerContent(this.el).cursorPos;
  }

  set selectionStart(pos: number) {
    setComposerCursor(this.el, pos);
  }

  get selectionEnd(): number {
    return this.selectionStart;
  }

  set selectionEnd(pos: number) {
    this.selectionStart = pos;
  }

  focus(): void {
    this.el.focus();
  }

  blur(): void {
    this.el.blur();
  }

  getBoundingClientRect(): DOMRect {
    return this.el.getBoundingClientRect();
  }

  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ): void {
    this.el.addEventListener(type, listener, options);
  }

  removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | EventListenerOptions,
  ): void {
    this.el.removeEventListener(type, listener, options);
  }

  insertReplacement(beforeAt: string, replacement: string, afterCursor: string): void {
    const text = beforeAt + replacement + afterCursor;
    const cursorPos = beforeAt.length + replacement.length;
    this.isSyncing = true;
    try {
      buildComposerFromText(this.el, text, this.getMentionContext(), cursorPos);
      this.updateEmptyState();
    } finally {
      this.isSyncing = false;
    }
  }

  /** Paste handler: plain text only. */
  handlePaste(event: ClipboardEvent): void {
    const text = event.clipboardData?.getData('text/plain');
    if (!text) {
      return;
    }
    event.preventDefault();
    insertPlainTextAtSelection(text);
    this.syncMentionBadgesFromContent();
    this.updateEmptyState();
    this.el.dispatchEvent(new Event('input', { bubbles: true }));
  }

  private onEditorInput(): void {
    if (this.isSyncing) {
      return;
    }
    // Rebuilding the composer during IME composition breaks CJK input.
    if (!this.isComposing) {
      this.maybeSyncMentionBadgesFromContent();
    }
    this.updateEmptyState();
  }

  private scheduleMentionSyncAfterComposition(): void {
    this.clearCompositionSyncTimer();
    this.compositionSyncTimer = window.setTimeout(() => {
      this.compositionSyncTimer = null;
      this.maybeSyncMentionBadgesFromContent();
      this.updateEmptyState();
    }, 0);
  }

  private clearCompositionSyncTimer(): void {
    if (this.compositionSyncTimer !== null) {
      window.clearTimeout(this.compositionSyncTimer);
      this.compositionSyncTimer = null;
    }
  }

  /** Converts typed @mentions and /commands into inline badges when recognized. */
  syncMentionBadgesFromContent(): void {
    this.maybeSyncMentionBadgesFromContent(true);
  }

  private maybeSyncMentionBadgesFromContent(force = false): void {
    const { text, cursorPos } = extractComposerContent(this.el);
    const ctx = this.getMentionContext();

    if (!force && !shouldSyncMentionBadgesOnInput(this.el, text, cursorPos, ctx)) {
      return;
    }

    const parts = parseMessageMentions(text, ctx);
    if (!parts.some((part) => part.kind !== 'plain')) {
      return;
    }

    this.isSyncing = true;
    try {
      buildComposerFromText(this.el, text, ctx, cursorPos);
    } finally {
      this.isSyncing = false;
    }
  }

  private updateEmptyState(): void {
    const empty = this.value.trim() === '';
    this.el.toggleClass('obsius2-rich-input-empty', empty);
  }
}

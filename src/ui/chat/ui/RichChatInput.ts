import { createInlineContextToken, type InlineContextReference } from '@pivi/pivi-agent-core/context/inlineContext';

import type { ComposerInput } from '@/ui/shared/mention/composerInputTypes';
import {
  buildComposerFromText,
  extractComposerContent,
  findNodeAtPlainTextOffset,
  insertPlainTextAtSelection,
  setComposerCursor,
  shouldSyncMentionBadgesOnInput,
} from '@/ui/shared/mention/inlineMentionBadgeDom';
import type { MentionBadgeParseContext } from '@/ui/shared/mention/mentionBadgeTypes';
import { parseMessageMentions } from '@/ui/shared/mention/parseMessageMentions';

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
      cls: ['pivi-input', 'pivi-rich-input', 'pivi-rich-input-empty', options.className].filter(Boolean).join(' '),
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

  getTextOffsetClientRect(offset: number): DOMRect | null {
    const position = findNodeAtPlainTextOffset(this.el, offset);
    if (!position) {
      return null;
    }

    const range = this.el.ownerDocument.createRange();
    range.setStart(position.node, position.offset);
    if (position.node.nodeType === Node.TEXT_NODE) {
      const textLength = position.node.textContent?.length ?? 0;
      range.setEnd(position.node, Math.min(position.offset + 1, textLength));
    } else {
      range.collapse(true);
    }

    const rect = range.getBoundingClientRect();
    return rect.width > 0 || rect.height > 0 ? rect : null;
  }

  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ): void {
    this.el.addEventListener(type, listener, options);
  }

  dispatchEvent(event: Event): boolean {
    return this.el.dispatchEvent(event);
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

  insertInlineContext(context: InlineContextReference): void {
    const token = createInlineContextToken(context);
    const { text, cursorPos } = extractComposerContent(this.el);
    const prefix = text.slice(0, cursorPos).trimEnd();
    const suffix = text.slice(cursorPos).trimStart();
    const nextText = [prefix, token, suffix]
      .filter((part) => part.length > 0)
      .join(' ');
    const nextCursor = prefix.length + (prefix ? 1 : 0) + token.length + 1;

    this.isSyncing = true;
    try {
      buildComposerFromText(this.el, nextText, this.getMentionContext(), Math.min(nextCursor, nextText.length));
      this.updateEmptyState();
    } finally {
      this.isSyncing = false;
    }
    this.el.dispatchEvent(new Event('input', { bubbles: true }));
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

  /** Converts typed @mentions and / tool tokens into inline badges when recognized. */
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
    this.el.toggleClass('pivi-rich-input-empty', empty);
  }
}

import type { MentionBadgeParseContext } from '@pivi/pivi-agent-core/context/mentions';
import { parseMessageMentions } from '@pivi/pivi-agent-core/context/mentions';
import type { App } from 'obsidian';

import type { ComposerInput } from '@/ui/shared/mention/composerInputTypes';
import {
  buildComposerFromText,
  extractComposerContent,
  findNodeAtPlainTextOffset,
  insertPlainTextAtSelection,
  setComposerCursor,
  shouldSyncMentionBadgesOnInput,
} from '@/ui/shared/mention/inlineMentionBadgeDom';

export type { ComposerInput };

export interface MentionInputOptions {
  placeholder?: string;
  className?: string;
  app: App;
  getMentionContext: () => MentionBadgeParseContext;
}

/**
 * Contenteditable input with inline mention badges (textarea-compatible API).
 *
 * Shared base for any surface that needs `@`/`/` mention token rendering with a
 * plain-text round trip. Chat-specific behavior (inline-context insertion,
 * ordered-list continuation) belongs in subclasses under `src/ui/chat`.
 */
export class MentionInput implements ComposerInput {
  readonly el: HTMLDivElement;

  protected readonly app: App;
  protected getMentionContext: () => MentionBadgeParseContext;

  setMentionContextGetter(getter: () => MentionBadgeParseContext): void {
    this.getMentionContext = getter;
  }
  protected isSyncing = false;
  protected isComposing = false;
  protected compositionSyncTimer: number | null = null;

  constructor(parent: HTMLElement, options: MentionInputOptions) {
    this.app = options.app;
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

    this.el.appendChild(this.el.ownerDocument.createTextNode(''));
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
      buildComposerFromText(this.el, text, this.getMentionContext(), this.app);
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

  contains(node: Node | null): boolean {
    return this.el.contains(node);
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
      buildComposerFromText(this.el, text, this.getMentionContext(), this.app, cursorPos);
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
    this.dispatchInputEvent();
  }

  protected onEditorInput(): void {
    if (this.isSyncing) {
      return;
    }
    // Rebuilding the composer during IME composition breaks CJK input.
    if (!this.isComposing) {
      this.maybeSyncMentionBadgesFromContent();
    }
    this.updateEmptyState();
  }

  protected scheduleMentionSyncAfterComposition(): void {
    this.clearCompositionSyncTimer();
    this.compositionSyncTimer = this.el.ownerDocument.defaultView?.setTimeout(() => {
      this.compositionSyncTimer = null;
      this.maybeSyncMentionBadgesFromContent();
      this.updateEmptyState();
    }, 0) ?? null;
  }

  protected clearCompositionSyncTimer(): void {
    if (this.compositionSyncTimer !== null) {
      this.el.ownerDocument.defaultView?.clearTimeout(this.compositionSyncTimer);
      this.compositionSyncTimer = null;
    }
  }

  protected dispatchInputEvent(): void {
    const EventConstructor = this.el.ownerDocument.defaultView?.Event;
    if (!EventConstructor) {
      throw new Error('Pivi rich input has no owning window.');
    }
    this.el.dispatchEvent(new EventConstructor('input', { bubbles: true }));
  }

  /** Converts typed @mentions and / tool tokens into inline badges when recognized. */
  syncMentionBadgesFromContent(): void {
    this.maybeSyncMentionBadgesFromContent(true);
  }

  protected maybeSyncMentionBadgesFromContent(force = false): void {
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
      buildComposerFromText(this.el, text, ctx, this.app, cursorPos);
    } finally {
      this.isSyncing = false;
    }
  }

  protected updateEmptyState(): void {
    const empty = this.value.trim() === '';
    this.el.toggleClass('pivi-rich-input-empty', empty);
  }
}

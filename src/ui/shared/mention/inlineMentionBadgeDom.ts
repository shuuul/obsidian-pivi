import type { MentionBadgeParseContext, MentionBadgePart } from '@pivi/agent/context/mentions';
import { messageTextHasMentionBadges, parseMessageMentions } from '@pivi/agent/context/mentions';
import type { App } from 'obsidian';

import { removeContextBadgeFromComposer } from '../context-badge/ContextBadgeDom';
import { mentionPartToContextBadgeToken } from '../context-badge/ContextBadgeParser';
import { createContextBadgeElement } from '../context-badge/ContextBadgeRenderer';
import {
  getActiveDocument,
  getActiveWindow,
} from '../dom';
import { revealInlineContext } from './inlineContextNavigation';

export function createInlineMentionBadge(
  part: MentionBadgePart,
  app: App,
  root?: HTMLElement,
): HTMLSpanElement {
  if (part.kind === 'plain') {
    return getActiveDocument(root).win.createSpan();
  }

  const token = mentionPartToContextBadgeToken(part);

  return createContextBadgeElement(token, {
    root,
    inline: true,
    onClick: token.kind === 'file'
      ? () => {
        void app.workspace.openLinkText(token.path, '');
      }
      : token.kind === 'inline-context'
        ? () => {
          void revealInlineContext(app, token.context);
        }
        : undefined,
    onRemove: token.kind === 'inline-context' || token.kind === 'selected-text-template'
      ? (_token, event) => {
        if (!(event.currentTarget instanceof HTMLElement)) return;
        const badge = event.currentTarget.closest('.pivi-context-badge');
        if (badge instanceof HTMLElement) {
          removeContextBadgeFromComposer(badge);
        }
      }
      : undefined,
  });
}

function isHtmlElement(node: Node): node is HTMLElement {
  return node.instanceOf(HTMLElement);
}

function mentionTokenOf(node: HTMLElement): string | undefined {
  return node.dataset.mentionToken;
}

function canonicalNodeLength(node: Node): number {
  if (node.nodeType === Node.TEXT_NODE) {
    return node.textContent?.length ?? 0;
  }
  if (!isHtmlElement(node)) {
    return 0;
  }
  const token = mentionTokenOf(node);
  if (token) {
    return token.length;
  }
  if (node.tagName === 'BR') {
    return 1;
  }
  let length = 0;
  for (const child of node.childNodes) {
    length += canonicalNodeLength(child);
  }
  return length;
}

function canonicalOffsetBefore(editor: HTMLElement, target: Node): number {
  let offset = 0;

  function walk(node: Node): boolean {
    if (node === target) {
      return true;
    }
    if (node.nodeType === Node.TEXT_NODE) {
      offset += node.textContent?.length ?? 0;
      return false;
    }
    if (!isHtmlElement(node)) {
      return false;
    }
    const token = mentionTokenOf(node);
    if (token) {
      offset += token.length;
      return false;
    }
    if (node.tagName === 'BR') {
      offset += 1;
      return false;
    }
    for (const child of node.childNodes) {
      if (walk(child)) {
        return true;
      }
    }
    return false;
  }

  for (const child of editor.childNodes) {
    if (walk(child)) {
      break;
    }
  }
  return offset;
}

function enclosingMentionBadge(editor: HTMLElement, node: Node): HTMLElement | null {
  if (node === editor) {
    return null;
  }
  const start = isHtmlElement(node) ? node : node.parentElement;
  const badge = start?.closest('[data-mention-token]');
  if (badge?.instanceOf(HTMLElement) && editor.contains(badge)) {
    return badge;
  }
  return null;
}

function canonicalPoint(
  editor: HTMLElement,
  container: Node,
  offset: number,
  snap: 'start' | 'end',
): number {
  const badge = enclosingMentionBadge(editor, container);
  if (badge) {
    const prefix = canonicalOffsetBefore(editor, badge);
    const tokenLength = mentionTokenOf(badge)?.length ?? 0;
    return snap === 'start' ? prefix : prefix + tokenLength;
  }

  if (container === editor) {
    let accumulated = 0;
    const limit = Math.min(offset, editor.childNodes.length);
    for (let index = 0; index < limit; index++) {
      accumulated += canonicalNodeLength(editor.childNodes[index]!);
    }
    return accumulated;
  }

  if (container.nodeType === Node.TEXT_NODE) {
    return canonicalOffsetBefore(editor, container) + offset;
  }

  if (isHtmlElement(container)) {
    let accumulated = canonicalOffsetBefore(editor, container);
    const limit = Math.min(offset, container.childNodes.length);
    for (let index = 0; index < limit; index++) {
      accumulated += canonicalNodeLength(container.childNodes[index]!);
    }
    return accumulated;
  }

  return canonicalOffsetBefore(editor, container);
}

/**
 * Canonical composer text for the current selection.
 * A range that intersects an inline badge copies the whole `data-mention-token`.
 * Returns null when the selection is collapsed or outside the editor.
 */
export function extractComposerSelection(editor: HTMLElement): {
  text: string;
  start: number;
  end: number;
} | null {
  const selection = getActiveWindow(editor).getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
    return null;
  }

  const range = selection.getRangeAt(0);
  const ancestor = range.commonAncestorContainer;
  if (ancestor !== editor && !editor.contains(ancestor)) {
    return null;
  }

  const { text } = extractComposerContent(editor);
  const start = Math.max(0, Math.min(
    canonicalPoint(editor, range.startContainer, range.startOffset, 'start'),
    text.length,
  ));
  const end = Math.max(0, Math.min(
    canonicalPoint(editor, range.endContainer, range.endOffset, 'end'),
    text.length,
  ));
  const from = Math.min(start, end);
  const to = Math.max(start, end);
  if (from === to) {
    return null;
  }
  return { text, start: from, end: to };
}

export function extractComposerContent(editor: HTMLElement): {
  text: string;
  cursorPos: number;
} {
  const selection = getActiveWindow(editor).getSelection();
  const focusNode = selection?.focusNode ?? null;
  const focusOffset = selection?.focusOffset ?? 0;

  let text = '';
  let cursorPos = 0;
  let foundCursor = false;

  function walk(node: Node): void {
    if (node.nodeType === Node.TEXT_NODE) {
      const content = node.textContent ?? '';
      if (!foundCursor && node === focusNode) {
        cursorPos = text.length + focusOffset;
        foundCursor = true;
      }
      text += content;
      return;
    }

    if (!(node.instanceOf(HTMLElement))) {
      return;
    }

    const token = node.dataset.mentionToken;
    if (token) {
      if (!foundCursor && (node === focusNode || node.contains(focusNode))) {
        cursorPos = text.length + token.length;
        foundCursor = true;
      }
      text += token;
      return;
    }

    if (node.tagName === 'BR') {
      if (!foundCursor && node === focusNode) {
        cursorPos = text.length;
        foundCursor = true;
      }
      text += '\n';
      return;
    }

    for (const child of node.childNodes) {
      walk(child);
    }
  }

  for (const child of editor.childNodes) {
    walk(child);
  }

  if (!foundCursor) {
    cursorPos = text.length;
  }

  return { text, cursorPos };
}

export function findNodeAtPlainTextOffset(
  editor: HTMLElement,
  targetOffset: number,
): { node: Node; offset: number } | null {
  let accumulated = 0;

  for (const child of editor.childNodes) {
    if (child.nodeType === Node.TEXT_NODE) {
      const len = child.textContent?.length ?? 0;
      if (accumulated + len >= targetOffset) {
        return { node: child, offset: targetOffset - accumulated };
      }
      accumulated += len;
      continue;
    }

    if (child.instanceOf(HTMLElement) && child.dataset.mentionToken) {
      const tokenLen = child.dataset.mentionToken.length;
      if (accumulated + tokenLen >= targetOffset) {
        const next = child.nextSibling;
        if (next) {
          return { node: next, offset: 0 };
        }
        return null;
      }
      accumulated += tokenLen;
      continue;
    }

    if (child.instanceOf(HTMLElement) && child.tagName === 'BR') {
      if (accumulated + 1 >= targetOffset) {
        const next = child.nextSibling;
        if (next) {
          return { node: next, offset: 0 };
        }
        return null;
      }
      accumulated += 1;
    }
  }

  const last = editor.lastChild;
  if (last?.nodeType === Node.TEXT_NODE) {
    return { node: last, offset: last.textContent?.length ?? 0 };
  }
  return null;
}

export function setComposerCursor(editor: HTMLElement, cursorPos: number): void {
  const position = findNodeAtPlainTextOffset(editor, cursorPos);
  if (!position) {
    return;
  }

  const sel = getActiveWindow(editor).getSelection();
  if (!sel) {
    return;
  }

  const range = getActiveDocument(editor).createRange();
  range.setStart(position.node, position.offset);
  range.collapse(true);
  sel.removeAllRanges();
  sel.addRange(range);
}

export function countInlineMentionBadges(editor: HTMLElement): number {
  return editor.querySelectorAll('[data-mention-token]').length;
}

export function countParsableMentionParts(
  text: string,
  ctx: MentionBadgeParseContext,
): number {
  return parseMessageMentions(text, ctx).filter((part) => part.kind !== 'plain').length;
}

/**
 * Whether typed input should trigger a full composer rebuild.
 * Avoids syncing on every keystroke (breaks CJK IME) — only when tokens are complete.
 */
export function shouldSyncMentionBadgesOnInput(
  editor: HTMLElement,
  text: string,
  cursorPos: number,
  ctx: MentionBadgeParseContext,
): boolean {
  if (!messageTextHasMentionBadges(text, ctx)) {
    return false;
  }

  if (countInlineMentionBadges(editor) >= countParsableMentionParts(text, ctx)) {
    return false;
  }

  // Convert after user finishes a mention/command token (typically typed a space).
  if (cursorPos > 0) {
    const prev = text[cursorPos - 1];
    if (!prev || !/\s/.test(prev)) {
      return false;
    }
  }

  return true;
}

export function buildComposerFromText(
  editor: HTMLElement,
  text: string,
  ctx: MentionBadgeParseContext,
  app: App,
  cursorPos?: number,
): void {
  editor.empty();

  const parts = parseMessageMentions(text, ctx);
  for (const part of parts) {
    if (part.kind === 'plain') {
      if (part.text) {
        editor.appendText(part.text);
      }
      continue;
    }
    editor.appendChild(createInlineMentionBadge(part, app, editor));
  }

  if (editor.childNodes.length === 0) {
    editor.appendChild(getActiveDocument(editor).createTextNode(''));
  }

  const targetCursor = cursorPos ?? text.length;
  setComposerCursor(editor, targetCursor);
}

export function insertPlainTextAtSelection(text: string): void {
  const selection = activeWindow.getSelection();
  if (!selection || selection.rangeCount === 0) {
    return;
  }

  const range = selection.getRangeAt(0);
  range.deleteContents();
  const textNode = getActiveDocument().createTextNode(text);
  range.insertNode(textNode);
  range.setStartAfter(textNode);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
}

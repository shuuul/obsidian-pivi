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
import { getMentionBadgeNavigation } from './mentionBadgeNavigation';

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
    onClick: getMentionBadgeNavigation(app, token),
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

function isComposerLine(node: Node | null): boolean {
  return !!node && isHtmlElement(node) && (node.tagName === 'DIV' || node.tagName === 'P');
}

// Enter in Chromium creates block wrappers, not necessarily <br> nodes.
// These boundaries must count identically in text and selection coordinates.
function lineBreakBefore(node: Node): number {
  return node.previousSibling && (isComposerLine(node) || isComposerLine(node.previousSibling)) ? 1 : 0;
}

function isEmptyLinePlaceholder(node: Node): boolean {
  return isHtmlElement(node) && node.tagName === 'BR'
    && isComposerLine(node.parentNode) && node.parentNode?.childNodes.length === 1;
}

function canonicalNodeLength(node: Node): number {
  const boundary = lineBreakBefore(node);
  if (node.nodeType === Node.TEXT_NODE) {
    return boundary + (node.textContent?.length ?? 0);
  }
  if (!isHtmlElement(node)) {
    return 0;
  }
  const token = mentionTokenOf(node);
  if (token) {
    return boundary + token.length;
  }
  if (node.tagName === 'BR') {
    return boundary + (isEmptyLinePlaceholder(node) ? 0 : 1);
  }
  let length = boundary;
  for (const child of node.childNodes) {
    length += canonicalNodeLength(child);
  }
  return length;
}

function canonicalOffsetBefore(editor: HTMLElement, target: Node): number {
  let offset = 0;

  function walk(node: Node): boolean {
    offset += lineBreakBefore(node);
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
      offset += isEmptyLinePlaceholder(node) ? 0 : 1;
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

  function walk(node: Node): void {
    if (lineBreakBefore(node)) text += '\n';
    if (node.nodeType === Node.TEXT_NODE) {
      text += node.textContent ?? '';
      return;
    }

    if (!(node.instanceOf(HTMLElement))) {
      return;
    }

    const token = node.dataset.mentionToken;
    if (token) {
      text += token;
      return;
    }

    if (node.tagName === 'BR') {
      if (!isEmptyLinePlaceholder(node)) text += '\n';
      return;
    }

    for (const child of node.childNodes) {
      walk(child);
    }
  }

  for (const child of editor.childNodes) {
    walk(child);
  }

  const cursorPos = focusNode && (focusNode === editor || editor.contains(focusNode))
    ? canonicalPoint(editor, focusNode, focusOffset, 'end')
    : text.length;
  return { text, cursorPos };
}

export function findNodeAtPlainTextOffset(
  editor: HTMLElement,
  targetOffset: number,
): { node: Node; offset: number } | null {
  let accumulated = 0;
  const target = Math.max(0, targetOffset);

  function walk(parent: Node): { node: Node; offset: number } | null {
    for (let index = 0; index < parent.childNodes.length; index++) {
      const child = parent.childNodes[index]!;
      if (target <= accumulated) return { node: parent, offset: index };
      accumulated += lineBreakBefore(child);
      if (child.nodeType === Node.TEXT_NODE) {
        const len = child.textContent?.length ?? 0;
        if (target <= accumulated + len) {
          return { node: child, offset: Math.max(0, target - accumulated) };
        }
        accumulated += len;
      } else if (isHtmlElement(child)) {
        const token = mentionTokenOf(child);
        if (token || child.tagName === 'BR') {
          accumulated += token?.length ?? (isEmptyLinePlaceholder(child) ? 0 : 1);
          if (target <= accumulated) return { node: parent, offset: index + 1 };
        } else {
          const found = walk(child);
          if (found) return found;
        }
      }
    }
    return null;
  }

  return walk(editor) ?? { node: editor, offset: editor.childNodes.length };
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

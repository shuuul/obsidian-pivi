import type { MentionBadgeParseContext, MentionBadgePart } from '@pivi/pivi-agent-core/context/mentions';
import { messageTextHasMentionBadges, parseMessageMentions } from '@pivi/pivi-agent-core/context/mentions';
import type { App } from 'obsidian';

import { removeContextBadgeFromComposer } from '../context-badge/ContextBadgeDom';
import { mentionPartToContextBadgeToken } from '../context-badge/ContextBadgeParser';
import { createContextBadgeElement } from '../context-badge/ContextBadgeRenderer';
import {
  getActiveDocument,
  getActiveWindow,
} from '../dom';

/** Plain-text token stored in the composer and sent to the agent. */
export function mentionPartToToken(part: MentionBadgePart): string {
  switch (part.kind) {
    case 'file':
      return part.raw;
    case 'folder':
      return part.raw;
    case 'mcp':
      return part.raw;
    case 'skill':
      return part.raw;
    case 'tool':
      return part.raw;
    case 'agent':
      return part.raw;
    case 'inline-context':
      return part.raw;
    default:
      return '';
  }
}

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
      : undefined,
    onRemove: token.kind === 'inline-context'
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
  if (!messageTextHasMentionBadges(text)) {
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

export function insertMentionBadgeAtOffset(
  editor: HTMLElement,
  contextStart: number,
  contextEnd: number,
  part: MentionBadgePart,
  app: App,
): void {
  const startPos = findNodeAtPlainTextOffset(editor, contextStart);
  const endPos = findNodeAtPlainTextOffset(editor, contextEnd);
  if (!startPos || !endPos) {
    return;
  }

  const sel = getActiveWindow(editor).getSelection();
  if (!sel) {
    return;
  }

  const range = getActiveDocument(editor).createRange();
  range.setStart(startPos.node, startPos.offset);
  range.setEnd(endPos.node, endPos.offset);
  range.deleteContents();

  const badge = createInlineMentionBadge(part, app, editor);
  const space = getActiveDocument(editor).createTextNode(' ');
  range.insertNode(space);
  range.insertNode(badge);

  range.setStartAfter(space);
  range.collapse(true);
  sel.removeAllRanges();
  sel.addRange(range);
}

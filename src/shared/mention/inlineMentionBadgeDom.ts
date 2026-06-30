import type { App } from 'obsidian';
import { setIcon } from 'obsidian';

import { getActiveDocument, getActiveWindow } from '../dom';
import { appendMcpIcon } from '../icons';
import {
  formatInlineContextTooltip,
  formatMcpBadgeLabel,
  formatRemoveInlineContextAriaLabel,
  formatSkillBadgeLabel,
} from './mentionBadgeLabels';
import type { MentionBadgeParseContext, MentionBadgePart } from './mentionBadgeTypes';
import { messageTextHasMentionBadges, parseMessageMentions } from './parseMessageMentions';

function getFileIconName(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'md':
      return 'file-text';
    case 'png':
    case 'jpg':
    case 'jpeg':
    case 'gif':
    case 'webp':
    case 'svg':
      return 'image';
    default:
      return 'file';
  }
}

function removeBadgeFromComposer(badge: HTMLSpanElement): void {
  const editor = badge.parentElement;
  if (!editor) {
    badge.remove();
    return;
  }

  const doc = getActiveDocument(editor);
  const selection = getActiveWindow(editor).getSelection();
  const nextFocusNode = badge.nextSibling ?? badge.previousSibling;
  badge.remove();

  if (editor.childNodes.length === 0) {
    editor.appendChild(doc.createTextNode(''));
  }

  const range = doc.createRange();
  if (nextFocusNode?.isConnected) {
    if (nextFocusNode.nodeType === Node.TEXT_NODE) {
      range.setStart(nextFocusNode, 0);
    } else {
      range.setStartAfter(nextFocusNode);
    }
  } else {
    range.selectNodeContents(editor);
    range.collapse(false);
  }
  range.collapse(true);
  selection?.removeAllRanges();
  selection?.addRange(range);
  const InputEventCtor = (getActiveWindow(editor) as Window & { Event: typeof Event }).Event;
  editor.dispatchEvent(new InputEventCtor('input', { bubbles: true }));
}

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
  const doc = getActiveDocument(root);
  const badge = doc.createElement('span');
  const token = mentionPartToToken(part);
  badge.className = 'pivi-inline-mention-badge';
  badge.contentEditable = 'false';
  badge.dataset.mentionToken = token;

  const isTool = part.kind === 'mcp' || part.kind === 'skill' || part.kind === 'agent';
  if (isTool) {
    badge.addClass('pivi-inline-mention-badge--tool');
  } else if (part.kind === 'inline-context') {
    badge.addClass('pivi-inline-mention-badge--inline-context');
  } else {
    badge.addClass('pivi-inline-mention-badge--context');
  }

  const iconEl = doc.createElement('span');
  iconEl.className = 'pivi-inline-mention-icon';
  if (part.kind === 'mcp') {
    appendMcpIcon(iconEl);
  } else if (part.kind === 'folder') {
    setIcon(iconEl, 'folder');
  } else if (part.kind === 'skill') {
    setIcon(iconEl, 'sparkles');
  } else if (part.kind === 'agent') {
    setIcon(iconEl, 'bot');
  } else if (part.kind === 'inline-context') {
    setIcon(iconEl, 'text-select');
  } else if (part.kind === 'file') {
    setIcon(iconEl, getFileIconName(part.path));
  } else {
    setIcon(iconEl, 'file');
  }
  badge.appendChild(iconEl);

  const labelEl = doc.createElement('span');
  labelEl.className = 'pivi-inline-mention-label';
  switch (part.kind) {
    case 'file':
      labelEl.textContent = part.label;
      badge.title = part.path;
      break;
    case 'folder':
      labelEl.textContent = part.label;
      badge.title = part.path;
      break;
    case 'mcp': {
      const mcpLabel = formatMcpBadgeLabel(part.serverName, part.toolName);
      labelEl.textContent = mcpLabel;
      badge.title = part.toolName
        ? `MCP tool: ${part.serverName}/${part.toolName}`
        : `MCP server: ${part.serverName}`;
      break;
    }
    case 'skill': {
      const skillLabel = formatSkillBadgeLabel(part.commandName);
      labelEl.textContent = skillLabel;
      badge.title = `Skill: ${skillLabel}`;
      break;
    }
    case 'agent':
      labelEl.textContent = `@${part.label}`;
      badge.title = `Agent: ${part.agentId}`;
      break;
    case 'inline-context':
      labelEl.textContent = part.label;
      badge.title = formatInlineContextTooltip(part.context);
      badge.setAttribute('aria-label', badge.title);
      break;
    default:
      break;
  }
  badge.appendChild(labelEl);

  if (part.kind === 'inline-context') {
    const removeEl = doc.createElement('span');
    removeEl.className = 'pivi-inline-mention-remove';
    removeEl.contentEditable = 'false';
    removeEl.setAttribute('role', 'button');
    removeEl.setAttribute('tabindex', '0');
    removeEl.setAttribute('aria-label', formatRemoveInlineContextAriaLabel(part.context));
    removeEl.setAttribute('title', formatRemoveInlineContextAriaLabel(part.context));
    removeEl.textContent = '×';
    const remove = (event: Event) => {
      event.preventDefault();
      event.stopPropagation();
      removeBadgeFromComposer(badge);
    };
    removeEl.addEventListener('click', remove);
    removeEl.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') {
        return;
      }
      remove(event);
    });
    badge.appendChild(removeEl);
  }

  if (part.kind === 'file') {
    badge.addClass('pivi-inline-mention-badge--clickable');
    badge.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      void app.workspace.openLinkText(part.path, '');
    });
  }

  return badge;
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
    if (!/\s/.test(prev)) {
      return false;
    }
  }

  return true;
}

export function buildComposerFromText(
  editor: HTMLElement,
  text: string,
  ctx: MentionBadgeParseContext,
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
    editor.appendChild(createInlineMentionBadge(part, ctx.app, editor));
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
  ctx: MentionBadgeParseContext,
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

  const badge = createInlineMentionBadge(part, ctx.app, editor);
  const space = getActiveDocument(editor).createTextNode(' ');
  range.insertNode(space);
  range.insertNode(badge);

  range.setStartAfter(space);
  range.collapse(true);
  sel.removeAllRanges();
  sel.addRange(range);
}

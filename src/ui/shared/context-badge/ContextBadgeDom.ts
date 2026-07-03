import { getActiveDocument, getActiveWindow } from '../dom';

export function removeContextBadgeFromComposer(badge: HTMLElement): void {
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
  const EventCtor = (getActiveWindow(editor) as Window & { Event: typeof Event }).Event;
  editor.dispatchEvent(new EventCtor('input', { bubbles: true }));
}

import { useEffect, useRef } from 'react';

import { useT } from '../../i18n';
import type { ChatTabSnapshotItem } from '../../store';

export function EditableTabTitle({
  item,
  onCancel,
  onSubmit,
}: {
  item: ChatTabSnapshotItem;
  onCancel: () => void;
  onSubmit: (title: string) => void;
}) {
  const t = useT();
  const inputRef = useRef<HTMLSpanElement>(null);
  const cancelled = useRef(false);
  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.focus({ preventScroll: true });
    const selection = input.ownerDocument.defaultView?.getSelection();
    const range = input.ownerDocument.createRange();
    range.selectNodeContents(input);
    range.collapse(false);
    selection?.removeAllRanges();
    selection?.addRange(range);
  }, []);

  return (
    <span
      aria-label={t('chat.tabs.editTitleInputLabel')}
      className="pivi-tab-switcher-title-input"
      contentEditable
      onBlur={(event) => {
        if (cancelled.current) return;
        onSubmit(event.currentTarget.textContent?.trim() ?? '');
      }}
      onClick={event => event.stopPropagation()}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === 'Escape') {
          event.preventDefault();
          cancelled.current = true;
          onCancel();
        } else if (event.key === 'Enter') {
          event.preventDefault();
          event.currentTarget.blur();
        }
      }}
      onPaste={(event) => {
        event.preventDefault();
        event.stopPropagation();
        const text = event.clipboardData.getData('text/plain').replace(/[\r\n\u2028\u2029]+/g, ' ').trim();
        const selection = event.currentTarget.ownerDocument.getSelection();
        if (!selection || selection.rangeCount === 0) {
          event.currentTarget.textContent = text;
          return;
        }
        selection.deleteFromDocument();
        selection.getRangeAt(0).insertNode(event.currentTarget.ownerDocument.createTextNode(text));
        selection.collapseToEnd();
      }}
      ref={inputRef}
      role="textbox"
      suppressContentEditableWarning
    >
      {item.title}
    </span>
  );
}

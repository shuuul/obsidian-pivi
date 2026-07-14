export interface MarkdownListEdit {
  start: number;
  end: number;
  replacement: string;
  cursor: number;
}

/** Build the plain-text edit for continuing or exiting an ordered Markdown list. */
export function getOrderedListEnterEdit(text: string, cursor: number): MarkdownListEdit | null {
  const safeCursor = Math.max(0, Math.min(cursor, text.length));
  const lineStart = safeCursor === 0 ? 0 : text.lastIndexOf('\n', safeCursor - 1) + 1;
  const nextLineBreak = text.indexOf('\n', safeCursor);
  const lineEnd = nextLineBreak === -1 ? text.length : nextLineBreak;
  const line = text.slice(lineStart, lineEnd);
  const match = /^(\s*)(\d+)([.)])([ \t]+)(.*)$/.exec(line);
  if (!match) return null;

  const [, indent, number, delimiter, spacing, content] = match;
  if (indent === undefined || number === undefined || delimiter === undefined
    || spacing === undefined || content === undefined) {
    return null;
  }

  const markerLength = indent.length + number.length + delimiter.length + spacing.length;
  if (safeCursor - lineStart < markerLength) return null;

  if (content.trim() === '') {
    return {
      start: lineStart,
      end: lineEnd,
      replacement: '',
      cursor: lineStart,
    };
  }

  const nextMarker = `${indent}${BigInt(number) + 1n}${delimiter}${spacing}`;
  return {
    start: safeCursor,
    end: safeCursor,
    replacement: `\n${nextMarker}`,
    cursor: safeCursor + nextMarker.length + 1,
  };
}

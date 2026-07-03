/**
 * Normalizes assistant markdown before / after render to avoid blank vertical gaps
 * (e.g. empty <p> from leading newlines after tool_use blocks).
 */

/** Strip leading whitespace when opening a new streaming text block. */
export function stripLeadingWhitespaceForNewTextBlock(text: string): string {
  return text.replace(/^\s+/, '');
}

function isEmptyParagraph(p: HTMLParagraphElement): boolean {
  if (p.textContent?.trim()) {
    return false;
  }
  return !p.querySelector('img, pre, blockquote, table, .pivi-embedded-image');
}

/** Remove empty edge paragraphs produced by leading/trailing newlines in markdown. */
export function trimEmptyEdgeParagraphs(container: HTMLElement): void {
  let next = container.firstElementChild;
  while (next instanceof HTMLParagraphElement && isEmptyParagraph(next)) {
    const toRemove = next;
    next = next.nextElementSibling;
    toRemove.remove();
  }

  let prev = container.lastElementChild;
  while (prev instanceof HTMLParagraphElement && isEmptyParagraph(prev)) {
    const toRemove = prev;
    prev = prev.previousElementSibling;
    toRemove.remove();
  }
}

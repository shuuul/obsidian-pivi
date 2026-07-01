/**
 * Helpers for obsidian_edit old_string matching and actionable error hints.
 */

/** Alternate ASCII `"` with typographic “ and ” (odd open, even close). */
export function asciiDoubleQuotesToCurly(text: string): string {
  let useOpen = true;
  return text.replace(/"/g, () => {
    const ch = useOpen ? '\u201c' : '\u201d';
    useOpen = !useOpen;
    return ch;
  });
}

/** Map typographic double quotes to ASCII `"`. */
export function curlyDoubleQuotesToAscii(text: string): string {
  return text.replace(/[\u201c\u201d]/g, '"');
}

export interface OldStringMismatchHint {
  code: 'ascii_vs_curly_quotes';
  message: string;
}

/**
 * When old_string is absent from content, detect common copy/paste mismatches.
 */
export function detectOldStringMismatchHint(
  content: string,
  oldString: string,
): OldStringMismatchHint | null {
  if (content.includes(oldString)) {
    return null;
  }

  const curlyCandidate = asciiDoubleQuotesToCurly(oldString);
  if (curlyCandidate !== oldString && content.includes(curlyCandidate)) {
    return {
      code: 'ascii_vs_curly_quotes',
      message:
        'old_string uses ASCII straight quotes (") but the note uses curly quotes (“ ”). '
        + 'Copy old_string verbatim from the latest obsidian_read output.',
    };
  }

  const asciiCandidate = curlyDoubleQuotesToAscii(oldString);
  if (asciiCandidate !== oldString && content.includes(asciiCandidate)) {
    return {
      code: 'ascii_vs_curly_quotes',
      message:
        'old_string uses curly quotes (“ ”) but the note uses ASCII straight quotes ("). '
        + 'Copy old_string verbatim from the latest obsidian_read output.',
    };
  }

  return null;
}

export function buildOldStringNotFoundMessage(
  filePath: string,
  content: string,
  oldString: string,
): string {
  const base = `old_string not found in ${filePath}. `
    + 'Copy the exact substring from obsidian_read (same quotes, spaces, and line breaks).';

  const hint = detectOldStringMismatchHint(content, oldString);
  if (!hint) {
    return base;
  }

  return `${base} ${hint.message}`;
}

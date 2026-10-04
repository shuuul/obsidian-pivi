/** Alternate ASCII `"` with typographic “ and ” (odd open, even close). */
function asciiDoubleQuotesToCurly(text: string): string {
  let useOpen = true;
  return text.replace(/"/g, () => {
    const ch = useOpen ? '\u201c' : '\u201d';
    useOpen = !useOpen;
    return ch;
  });
}

/** Map typographic double quotes to ASCII `"`. */
function curlyDoubleQuotesToAscii(text: string): string {
  return text.replace(/[\u201c\u201d]/g, '"');
}

export interface VaultEditMatchResult {
  content: string;
  replacements: number;
}

export interface VaultEditItem {
  oldText: string;
  newText: string;
  replaceAll?: boolean;
}

export function buildOldStringNotFoundMessage(
  filePath: string,
  content: string,
  oldString: string,
): string {
  const base = `old_string not found in ${filePath}. `
    + 'Copy the exact substring from read (same quotes, spaces, and line breaks).';

  const curlyCandidate = asciiDoubleQuotesToCurly(oldString);
  if (curlyCandidate !== oldString && content.includes(curlyCandidate)) {
    return `${base} old_string uses ASCII straight quotes (") but the note uses curly quotes (“ ”). `
      + 'Copy old_string verbatim from the latest read output.';
  }

  const asciiCandidate = curlyDoubleQuotesToAscii(oldString);
  if (asciiCandidate !== oldString && content.includes(asciiCandidate)) {
    return `${base} old_string uses curly quotes (“ ”) but the note uses ASCII straight quotes ("). `
      + 'Copy old_string verbatim from the latest read output.';
  }

  return base;
}

/**
 * Apply every edit against the original file. Matches are not incremental.
 * Overlapping or nested spans fail; `replaceAll` still targets the original text.
 */
export function applyVaultEdits(params: {
  filePath: string;
  content: string;
  edits: readonly VaultEditItem[];
}): VaultEditMatchResult {
  const { content, filePath, edits } = params;
  if (edits.length === 0) {
    throw new Error('edits must contain at least one { oldText, newText } item.');
  }

  const spans: Array<{ start: number; end: number; newText: string; editIndex: number }> = [];
  for (let index = 0; index < edits.length; index++) {
    const edit = edits[index];
    if (edit === undefined) {
      continue;
    }
    if (!edit.oldText) {
      throw new Error(
        edits.length === 1 ? 'old_string must not be empty.' : `edits[${index}].oldText must not be empty.`,
      );
    }

    const starts: number[] = [];
    let from = 0;
    while (from <= content.length) {
      const found = content.indexOf(edit.oldText, from);
      if (found === -1) {
        break;
      }
      starts.push(found);
      from = found + edit.oldText.length;
    }
    if (starts.length === 0) {
      const message = buildOldStringNotFoundMessage(filePath, content, edit.oldText);
      throw new Error(edits.length === 1 ? message : `edits[${index}]: ${message}`);
    }
    if (starts.length > 1 && !edit.replaceAll) {
      throw new Error(
        edits.length === 1
          ? `old_string appears ${starts.length} times in ${filePath}; use replace_all or include more context`
          : `edits[${index}].oldText appears ${starts.length} times in ${filePath}; set replaceAll or include more context`,
      );
    }
    const used = edit.replaceAll ? starts : [starts[0]];
    for (const start of used) {
      if (start === undefined) {
        continue;
      }
      spans.push({
        start,
        end: start + edit.oldText.length,
        newText: edit.newText,
        editIndex: index,
      });
    }
  }

  spans.sort((left, right) => left.start - right.start);
  for (let index = 1; index < spans.length; index++) {
    const previous = spans[index - 1];
    const current = spans[index];
    if (previous === undefined || current === undefined) {
      continue;
    }
    if (previous.end > current.start) {
      throw new Error(
        `edits[${previous.editIndex}] and edits[${current.editIndex}] overlap in ${filePath}. `
        + 'Merge them into one edit or target disjoint regions.',
      );
    }
  }

  let nextContent = content;
  for (let index = spans.length - 1; index >= 0; index--) {
    const span = spans[index];
    if (span === undefined) {
      continue;
    }
    nextContent = `${nextContent.slice(0, span.start)}${span.newText}${nextContent.slice(span.end)}`;
  }
  return { content: nextContent, replacements: spans.length };
}

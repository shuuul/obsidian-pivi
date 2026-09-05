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

export interface VaultEditMatchResult {
  content: string;
  replacements: number;
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

/** Applies the exact-match policy used by `ObsidianVaultApi.editNote`. */
export function replaceVaultEditMatch(params: {
  filePath: string;
  content: string;
  oldString: string;
  newString: string;
  replaceAll?: boolean;
}): VaultEditMatchResult {
  const { content, filePath, newString, oldString } = params;
  if (!oldString) {
    throw new Error('old_string must not be empty.');
  }

  const parts = content.split(oldString);
  const replacements = parts.length - 1;
  if (replacements === 0) {
    throw new Error(buildOldStringNotFoundMessage(filePath, content, oldString));
  }
  if (replacements > 1 && !params.replaceAll) {
    throw new Error(
      `old_string appears ${replacements} times in ${filePath}; use replace_all or include more context`,
    );
  }

  return {
    content: params.replaceAll ? parts.join(newString) : content.replace(oldString, newString),
    replacements,
  };
}

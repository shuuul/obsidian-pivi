/** Pure note-content joins for append/prepend writes; prepend keeps YAML frontmatter first. */

export function joinNoteContent(
  existing: string,
  addition: string,
  inline: boolean,
  mode: 'append' | 'prepend',
): string {
  if (addition.length === 0) {
    return existing;
  }
  if (existing.length === 0) {
    return addition;
  }
  if (inline) {
    return mode === 'append' ? `${existing}${addition}` : `${addition}${existing}`;
  }
  if (mode === 'append') {
    const separator = existing.endsWith('\n') ? '' : '\n';
    return `${existing}${separator}${addition}`;
  }
  const separator = addition.endsWith('\n') ? '' : '\n';
  return `${addition}${separator}${existing}`;
}

export function prependAfterFrontmatter(existing: string, addition: string, inline: boolean): string {
  const split = splitFrontmatter(existing);
  const joined = joinNoteContent(split.body, addition, inline, 'prepend');
  if (!split.frontmatter) {
    return joined;
  }
  if (joined.length === 0 || split.frontmatter.endsWith('\n') || joined.startsWith('\n')) {
    return `${split.frontmatter}${joined}`;
  }
  return `${split.frontmatter}\n${joined}`;
}

function splitFrontmatter(content: string): { frontmatter: string | null; body: string } {
  if (!content.startsWith('---')) {
    return { frontmatter: null, body: content };
  }
  const afterOpen = content.startsWith('---\n')
    ? 4
    : content.startsWith('---\r\n')
      ? 5
      : -1;
  if (afterOpen < 0) {
    return { frontmatter: null, body: content };
  }
  const closeLf = content.indexOf('\n---', afterOpen - 1);
  if (closeLf < 0) {
    return { frontmatter: null, body: content };
  }
  const afterClose = closeLf + 4;
  if (content.startsWith('\r\n', afterClose)) {
    return { frontmatter: content.slice(0, afterClose + 2), body: content.slice(afterClose + 2) };
  }
  if (content.startsWith('\n', afterClose)) {
    return { frontmatter: content.slice(0, afterClose + 1), body: content.slice(afterClose + 1) };
  }
  if (afterClose === content.length) {
    return { frontmatter: content, body: '' };
  }
  return { frontmatter: null, body: content };
}

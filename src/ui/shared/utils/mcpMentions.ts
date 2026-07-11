export function extractMcpMentions(text: string, validNames: Set<string>): Set<string> {
  const mentions = new Set<string>();
  const regex = /(?:^|\s)\/([a-zA-Z0-9._-]+)(?:\/[^\s]+)?/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    const name = match[1];
    if (name !== undefined && validNames.has(name)) {
      mentions.add(name);
    }
  }

  return mentions;
}

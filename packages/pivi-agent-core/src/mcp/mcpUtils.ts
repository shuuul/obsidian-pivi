export function extractMcpMentions(text: string, validNames: Set<string>): Set<string> {
  const mentions = new Set<string>();
  const regex = /(?:^|\s)\/([a-zA-Z0-9._-]+)(?:\/[^\s]+)?/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    const name = match[1];
    if (!name) {
      continue;
    }
    if (validNames.has(name)) {
      mentions.add(name);
    }
  }

  return mentions;
}

/**
 * Transform MCP slash tokens in text by appending " MCP" after each valid /server or /server/tool token.
 * This is applied to the API request only, not shown in the input.
 */
export function transformMcpMentions(text: string, validNames: Set<string>): string {
  if (validNames.size === 0) return text;

  // Sort names by length (longest first) to avoid partial matches
  const sortedNames = Array.from(validNames).sort((a, b) => b.length - a.length);

  // Build single pattern with alternation (more efficient than N passes)
  const escapedNames = sortedNames.map(escapeRegExp).join('|');
  // Match /server or /server/tool at token boundaries, without consuming the leading whitespace.
  const pattern = new RegExp(
    `(^|\\s)/(${escapedNames})(/[^\\s]+)?(?! MCP)(?=$|\\s|[),.!?:;])`,
    'g'
  );

  return text.replace(pattern, (_match, prefix: string, server: string, tool: string | undefined) =>
    `${prefix}/${server}${tool ?? ''} MCP`
  );
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function parseCommand(command: string, providedArgs?: string[]): { cmd: string; args: string[] } {
  if (providedArgs && providedArgs.length > 0) {
    return { cmd: command, args: providedArgs };
  }

  const parts = splitCommandString(command);
  if (parts.length === 0) {
    return { cmd: '', args: [] };
  }

  const [cmd, ...args] = parts;
  if (!cmd) {
    return { cmd: '', args: [] };
  }
  return { cmd, args };
}

export function splitCommandString(cmdStr: string): string[] {
  const parts: string[] = [];
  let current = '';
  let inQuote = false;
  let quoteChar = '';

  for (let i = 0; i < cmdStr.length; i++) {
    const char = cmdStr[i];
    if (char === undefined) {
      continue;
    }

    if ((char === '"' || char === "'") && !inQuote) {
      inQuote = true;
      quoteChar = char;
      continue;
    }

    if (char === quoteChar && inQuote) {
      inQuote = false;
      quoteChar = '';
      continue;
    }

    if (/\s/.test(char) && !inQuote) {
      if (current) {
        parts.push(current);
        current = '';
      }
      continue;
    }

    current += char;
  }

  if (current) {
    parts.push(current);
  }

  return parts;
}

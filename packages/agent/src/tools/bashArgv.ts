/**
 * Parse the single-command shell syntax accepted by Bash authorization into argv.
 * Reject syntax that `$SHELL -lc` could interpret as more than literal arguments.
 */
export function tokenizeBashArgv(command: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let inQuote: '"' | "'" | null = null;

  for (let i = 0; i < command.length; i += 1) {
    const char = command[i]!;
    const code = char.charCodeAt(0);
    if ((code < 0x20 && char !== '\t') || code === 0x7f) {
      throw new Error('Bash command must not contain control syntax');
    }
    if (inQuote) {
      if (char === inQuote) {
        inQuote = null;
      } else if (char === '\\' && inQuote === '"' && i + 1 < command.length) {
        const escaped = command[i + 1]!;
        if (escaped === '\n' || escaped === '\r') {
          throw new Error('Bash command must not contain control syntax');
        }
        if (/[\\"$`]/.test(escaped)) {
          current += escaped;
          i += 1;
        } else {
          current += char;
        }
      } else if (inQuote === '"' && (char === '$' || char === '`')) {
        throw new Error('Bash command must not contain substitution syntax');
      } else {
        current += char;
      }
      continue;
    }
    if (char === '"' || char === "'") {
      inQuote = char;
    } else if (char === '\\' && i + 1 < command.length) {
      const escaped = command[i + 1]!;
      if (escaped === '\n' || escaped === '\r') {
        throw new Error('Bash command must not contain control syntax');
      }
      current += escaped;
      i += 1;
    } else if (/[;&|<>`$(){}]/.test(char)) {
      throw new Error('Bash command must not contain shell control or substitution syntax');
    } else if (/\s/.test(char)) {
      if (char !== ' ' && char !== '\t') {
        throw new Error('Bash command must not contain control syntax');
      }
      if (current) {
        tokens.push(current);
        current = '';
      }
    } else {
      current += char;
    }
  }
  if (inQuote) {
    throw new Error('Bash command has unmatched quotes');
  }
  if (current) tokens.push(current);
  return tokens;
}

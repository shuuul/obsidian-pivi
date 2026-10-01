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
    assertNoControlCharacter(char);
    if (inQuote) {
      if (char === inQuote) {
        inQuote = null;
      } else if (char === '\\' && inQuote === '"' && i + 1 < command.length) {
        const escaped = readEscapedCharacter(command, i);
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
      current += readEscapedCharacter(command, i);
      i += 1;
    } else if (/[;&|<>`$(){}]/.test(char)) {
      throw new Error('Bash command must not contain shell control or substitution syntax');
    } else if (/\s/.test(char)) {
      assertPlainWhitespace(char);
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

function assertNoControlCharacter(char: string): void {
  const code = char.charCodeAt(0);
  if ((code < 0x20 && char !== '\t') || code === 0x7f) {
    throw new Error('Bash command must not contain control syntax');
  }
}

function assertPlainWhitespace(char: string): void {
  if (char !== ' ' && char !== '\t') {
    throw new Error('Bash command must not contain control syntax');
  }
}

/** Returns the character after the backslash at `index`; a line continuation is rejected. */
function readEscapedCharacter(command: string, index: number): string {
  const escaped = command[index + 1]!;
  if (escaped === '\n' || escaped === '\r') {
    throw new Error('Bash command must not contain control syntax');
  }
  return escaped;
}

/**
 * Parse the literal argv subset accepted by Windows cmd.exe authorization.
 * Cmd has different quoting and expansion rules from POSIX shells, so it is
 * intentionally kept separate from tokenizeBashArgv.
 */
export function tokenizeCmdArgv(command: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let inQuotes = false;

  for (const char of command) {
    const code = char.charCodeAt(0);
    if ((code < 0x20 && char !== '\t') || code === 0x7f) {
      throw new Error('Bash command must not contain control syntax');
    }
    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (/[!%^]/.test(char)) {
      throw new Error('Bash command must not contain shell control or expansion syntax');
    }
    // cmd.exe does not reliably neutralize operators inside quotes, so prefix
    // authorization rejects them in every quoting state.
    if (/[;&|<>()]/.test(char)) {
      throw new Error('Bash command must not contain shell control or expansion syntax');
    }
    if (/\s/.test(char)) {
      if (char !== ' ' && char !== '\t') {
        throw new Error('Bash command must not contain control syntax');
      }
      if (inQuotes) {
        current += char;
        continue;
      }
      if (current) {
        tokens.push(current);
        current = '';
      }
      continue;
    }
    current += char;
  }

  if (inQuotes) {
    throw new Error('Bash command has unmatched quotes');
  }
  if (current) tokens.push(current);
  return tokens;
}

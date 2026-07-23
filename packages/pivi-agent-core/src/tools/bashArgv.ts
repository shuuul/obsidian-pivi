/** Parse the shell-free command syntax accepted by the Bash tool into argv. */
export function tokenizeBashArgv(command: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let inQuote: '"' | "'" | null = null;

  for (let i = 0; i < command.length; i += 1) {
    const char = command[i]!;
    if (inQuote) {
      if (char === inQuote) {
        inQuote = null;
      } else if (char === '\\' && inQuote === '"' && i + 1 < command.length) {
        current += command[i + 1]!;
        i += 1;
      } else {
        current += char;
      }
      continue;
    }
    if (char === '"' || char === "'") {
      inQuote = char;
    } else if (/\s/.test(char)) {
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

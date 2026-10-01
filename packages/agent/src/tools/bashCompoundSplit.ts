import { isWindowsCmdShell } from './bashAuthorization';

export type PersistableSplitResult =
  | { ok: true; components: string[] }
  | { ok: false };

/**
 * Split a command into persistable `&&` / pipeline components, or reject
 * redirects, substitutions, and unsupported control syntax.
 */
export function splitPersistableShellComponents(
  command: string,
  shellPath = '/bin/sh',
): PersistableSplitResult {
  const trimmed = command.trim();
  if (!trimmed) return { ok: false };
  try {
    const components = isWindowsCmdShell(shellPath)
      ? splitCmdComponents(trimmed)
      : splitPosixComponents(trimmed);
    if (components.length === 0 || components.some(component => !component.trim())) {
      return { ok: false };
    }
    return { ok: true, components: components.map(component => component.trim()) };
  } catch {
    return { ok: false };
  }
}

function assertNoControlCharacter(char: string): void {
  const code = char.charCodeAt(0);
  if ((code < 0x20 && char !== '\t') || code === 0x7f) {
    throw new Error('control');
  }
}

/** Rejects unquoted POSIX syntax that is never persistable; `&` and `|` are split by the caller. */
function assertPersistablePosixCharacter(char: string, next: string | undefined): void {
  if (char === '`' || char === '(' || char === ')' || char === '{' || char === '}' || char === ';') {
    throw new Error('control');
  }
  if (char === '<' || char === '>') throw new Error('redirect');
  if (char === '$' && (next === '(' || next === '{')) {
    throw new Error('substitution');
  }
}

/** Returns how many characters after `index` belong to the same quoted unit. */
function consumedAfterQuotedCharacter(command: string, index: number, inQuote: '"' | "'"): number {
  const char = command[index]!;
  if (inQuote !== '"' || char === inQuote) return 0;
  if (char === '\\' && index + 1 < command.length) return 1;
  if (char === '`' || (char === '$' && command[index + 1] === '(')) {
    throw new Error('substitution');
  }
  return 0;
}

function splitPosixComponents(command: string): string[] {
  const components: string[] = [];
  let current = '';
  let inQuote: '"' | "'" | null = null;

  for (let i = 0; i < command.length; i += 1) {
    const char = command[i]!;
    assertNoControlCharacter(char);
    if (inQuote) {
      const extra = consumedAfterQuotedCharacter(command, i, inQuote);
      if (char === inQuote) inQuote = null;
      current += command.slice(i, i + 1 + extra);
      i += extra;
      continue;
    }
    if (char === '"' || char === "'") {
      inQuote = char;
      current += char;
      continue;
    }
    if (char === '\\' && i + 1 < command.length) {
      const escaped = command[i + 1]!;
      if (escaped === '\n' || escaped === '\r') throw new Error('control');
      current += char + escaped;
      i += 1;
      continue;
    }
    assertPersistablePosixCharacter(char, command[i + 1]);
    if (char === '&') {
      if (command[i + 1] !== '&') throw new Error('background');
      components.push(current);
      current = '';
      i += 1;
      continue;
    }
    if (char === '|') {
      if (command[i + 1] === '|' || command[i + 1] === '&') {
        throw new Error('control');
      }
      components.push(current);
      current = '';
      continue;
    }
    current += char;
  }

  if (inQuote) throw new Error('quotes');
  components.push(current);
  return components;
}

function splitCmdComponents(command: string): string[] {
  const components: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < command.length; i += 1) {
    const char = command[i]!;
    const code = char.charCodeAt(0);
    if ((code < 0x20 && char !== '\t') || code === 0x7f) {
      throw new Error('control');
    }
    if (char === '"') {
      inQuotes = !inQuotes;
      current += char;
      continue;
    }
    if (/[!%^]/.test(char)) {
      throw new Error('expansion');
    }
    if (inQuotes) {
      current += char;
      continue;
    }
    if (char === '<' || char === '>' || char === '(' || char === ')') {
      throw new Error('control');
    }
    if (char === '&') {
      if (command[i + 1] === '&') {
        components.push(current);
        current = '';
        i += 1;
        continue;
      }
      throw new Error('background');
    }
    if (char === '|') {
      if (command[i + 1] === '|') throw new Error('control');
      components.push(current);
      current = '';
      continue;
    }
    current += char;
  }

  if (inQuotes) throw new Error('quotes');
  components.push(current);
  return components;
}

import * as path from 'node:path';

export interface LoginShellInvocation {
  executable: string;
  args: readonly string[];
}

/**
 * Resolve the user's login shell and build argv for a single-line command.
 * Loads shell startup files on Unix via `-lc` (or fish `-c`).
 */
export function buildLoginShellInvocation(
  command: string,
  env: NodeJS.ProcessEnv = process.env,
): LoginShellInvocation {
  const shellPath = resolveLoginShellPath(env);
  const base = path.basename(shellPath).toLowerCase();

  if (base === 'fish') {
    return { executable: shellPath, args: ['-c', command] };
  }

  if (process.platform === 'win32' && (base === 'cmd.exe' || base === 'cmd')) {
    return { executable: shellPath, args: ['/d', '/s', '/c', command] };
  }

  return { executable: shellPath, args: ['-lc', command] };
}

export function resolveLoginShellPath(env: NodeJS.ProcessEnv = process.env): string {
  const shell = env.SHELL?.trim();
  if (shell) {
    return shell;
  }
  if (process.platform === 'win32') {
    return env.ComSpec?.trim() || 'cmd.exe';
  }
  return '/bin/zsh';
}

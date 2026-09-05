import {
  buildEffectiveBashPermissions,
  matchBashCommandAllowlist,
  resolveLoginShellPath,
} from '@pivi/obsidian-tools';
import {
  formatBashPermissionLabel,
  isWindowsCmdShell,
  tokenizeBashArgv,
  tokenizeCmdArgv,
  type PersistentBashPermission,
} from '@pivi/agent/tools';

function exe(name: string): PersistentBashPermission {
  return { kind: 'executable', executable: { kind: 'name', value: name }, enabled: true };
}

function sub(name: string, command: string): PersistentBashPermission {
  return {
    kind: 'subcommand',
    executable: { kind: 'name', value: name },
    subcommand: command,
    enabled: true,
  };
}

describe('bash permission matching', () => {
  it('uses cmd.exe lookup defaults on Windows', () => {
    expect(buildEffectiveBashPermissions([], 'cmd.exe').map(formatBashPermissionLabel)).toEqual(['where', 'cd']);
    expect(buildEffectiveBashPermissions([], '/bin/sh').map(formatBashPermissionLabel)).toEqual(['which', 'type', 'pwd']);
    expect(buildEffectiveBashPermissions([], String.raw`C:\Program Files\Git\bin\bash.exe`).map(formatBashPermissionLabel))
      .toEqual(['which', 'type', 'pwd']);
    expect(buildEffectiveBashPermissions([], resolveLoginShellPath({ SHELL: String.raw`C:\Windows\System32\cmd.exe` }))
      .map(formatBashPermissionLabel)).toEqual(['where', 'cd']);
    expect(buildEffectiveBashPermissions([], resolveLoginShellPath({ SHELL: String.raw`C:\Program Files\Git\bin\bash.exe` }))
      .map(formatBashPermissionLabel)).toEqual(['which', 'type', 'pwd']);
  });

  it('does not treat command.com as cmd.exe', () => {
    expect(isWindowsCmdShell('command.com')).toBe(false);
    expect(isWindowsCmdShell(String.raw`C:\Windows\System32\command.com`)).toBe(false);
    expect(isWindowsCmdShell('cmd.exe')).toBe(true);
    expect(matchBashCommandAllowlist('git status', [exe('git')], 'command.com')).toBe(false);
  });

  it('tokenizes quoted argv literally', () => {
    expect(tokenizeBashArgv(`echo "a b" 'c d'`)).toEqual(['echo', 'a b', 'c d']);
  });

  it('matches executable and semantic subcommand scopes', () => {
    expect(matchBashCommandAllowlist('git status', [exe('git')])).toBe(true);
    expect(matchBashCommandAllowlist('git', [exe('git')])).toBe(true);
    expect(matchBashCommandAllowlist('npm run build --silent', [sub('npm', 'run')])).toBe(true);
    expect(matchBashCommandAllowlist('npm install', [sub('npm', 'run')])).toBe(false);
  });

  it.each([
    'git status; rm -rf .',
    'git status || rm -rf .',
    'git status < input',
    'git status > output',
    'git status 2>> output',
    'git `status`',
    'git $(status)',
    'git status\nrm -rf .',
    'git status\r rm -rf .',
    'git status\u0000rm',
  ])('rejects unsafe shell syntax in %p', (command) => {
    expect(matchBashCommandAllowlist(command, [exe('git')])).toBe(false);
  });

  it('matches persistable pipelines only when every component is granted', () => {
    expect(matchBashCommandAllowlist('git status && rm -rf .', [exe('git')])).toBe(false);
    expect(matchBashCommandAllowlist('git status && rm -rf .', [exe('git'), exe('rm')])).toBe(true);
    expect(matchBashCommandAllowlist('cat x | grep a', [exe('cat'), exe('grep')])).toBe(true);
  });

  it('allows shell metacharacters only when single-quoted as literal argv', () => {
    expect(matchBashCommandAllowlist("git show ';'", [sub('git', 'show')])).toBe(true);
  });

  it('rejects cmd.exe control syntax and unknown shells', () => {
    expect(matchBashCommandAllowlist('type \\& whoami', [exe('type')], String.raw`C:\Windows\System32\cmd.exe`)).toBe(false);
    expect(matchBashCommandAllowlist('echo %PATH%', [exe('echo')], 'cmd.exe')).toBe(false);
    expect(matchBashCommandAllowlist('echo foo ^& whoami', [exe('echo')], 'cmd.exe')).toBe(false);
    expect(matchBashCommandAllowlist('git status', [exe('git')], '/opt/custom-shell')).toBe(false);
  });

  it('matches safe argv through cmd.exe without enabling control syntax', () => {
    const shell = String.raw`C:\Windows\System32\cmd.exe`;
    expect(tokenizeCmdArgv(String.raw`where "Program Files\app.exe"`)).toEqual(['where', String.raw`Program Files\app.exe`]);
    expect(matchBashCommandAllowlist('git status', [exe('git')], shell)).toBe(true);
    expect(matchBashCommandAllowlist('npm run build --silent', [sub('npm', 'run')], shell)).toBe(true);
    expect(matchBashCommandAllowlist(String.raw`where "Program Files\app.exe"`, [exe('where')], shell)).toBe(true);
    expect(matchBashCommandAllowlist('git status & whoami', [exe('git')], shell)).toBe(false);
  });

  it('preserves POSIX double-quote backslashes instead of over-unescaping', () => {
    expect(tokenizeBashArgv('printf "a\\qb"')).toEqual(['printf', 'a\\qb']);
    expect(tokenizeBashArgv('printf "a\\\\b"')).toEqual(['printf', 'a\\b']);
  });
});

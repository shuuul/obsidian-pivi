import {
  buildEffectiveBashAllowlist,
  matchBashCommandAllowlist,
} from '@pivi/obsidian-tools';
import {
  createPrefixBashGrant,
  decodeBashGrant,
  encodeBashGrant,
  tokenizeBashArgv,
} from '@pivi/agent/tools';

describe('bashAllowlist shell-aware matching', () => {
  it('uses cmd.exe lookup defaults on Windows', () => {
    expect(buildEffectiveBashAllowlist([], 'cmd.exe')).toEqual(['where', 'cd']);
    expect(buildEffectiveBashAllowlist([], '/bin/sh')).toEqual(['which', 'type', 'pwd']);
  });

  it('tokenizes quoted argv literally', () => {
    expect(tokenizeBashArgv(`echo "a b" 'c d'`)).toEqual(['echo', 'a b', 'c d']);
  });

  it('matches exact commands and argument prefixes', () => {
    expect(matchBashCommandAllowlist('git status', ['git'])).toBe(true);
    expect(matchBashCommandAllowlist('git', ['git'])).toBe(true);
    expect(matchBashCommandAllowlist('npm run build --silent', ['npm run build'])).toBe(true);
  });

  it('rejects commands outside the allowlist prefix', () => {
    expect(matchBashCommandAllowlist('npm install', ['npm run build'])).toBe(false);
    expect(matchBashCommandAllowlist('npm run build:evil', ['npm run build'])).toBe(false);
  });

  it.each([
    'git status; rm -rf .',
    'git status && rm -rf .',
    'git status || rm -rf .',
    'git status | cat',
    'git status < input',
    'git status > output',
    'git status 2>> output',
    'git `status`',
    'git $(status)',
    'git status\nrm -rf .',
    'git status\r rm -rf .',
    'git status\u0000rm',
  ])('rejects active shell syntax in %p', (command) => {
    expect(matchBashCommandAllowlist(command, ['git'])).toBe(false);
  });

  it('allows shell metacharacters only when single-quoted as literal argv', () => {
    expect(matchBashCommandAllowlist("git show ';'", ['git show'])).toBe(true);
  });

  it('rejects cmd.exe control syntax and unknown shells', () => {
    expect(matchBashCommandAllowlist('type \\& whoami', ['type'], 'C:\\Windows\\System32\\cmd.exe')).toBe(false);
    expect(matchBashCommandAllowlist('echo %PATH%', ['echo'], 'cmd.exe')).toBe(false);
    expect(matchBashCommandAllowlist('echo foo ^& whoami', ['echo'], 'cmd.exe')).toBe(false);
    expect(matchBashCommandAllowlist('git status', ['git'], '/opt/custom-shell')).toBe(false);
  });

  it('matches safe argv prefixes through cmd.exe without enabling control syntax', () => {
    const shell = 'C:\\Windows\\System32\\cmd.exe';
    expect(matchBashCommandAllowlist('git status', ['git'], shell)).toBe(true);
    expect(matchBashCommandAllowlist('npm run build --silent', ['npm run build'], shell)).toBe(true);
    expect(matchBashCommandAllowlist('where "Program Files\\app.exe"', ['where'], shell)).toBe(true);
    expect(matchBashCommandAllowlist('git status & whoami', ['git'], shell)).toBe(false);
    expect(matchBashCommandAllowlist('echo %PATH%', ['echo'], shell)).toBe(false);
    expect(matchBashCommandAllowlist('echo "%PATH%"', ['echo'], shell)).toBe(false);
  });

  it('distinguishes tagged exact grants from prefixes, including unsafe exact commands', () => {
    expect(matchBashCommandAllowlist('printf x | cat', ['exact: printf x | cat'], '/bin/zsh')).toBe(true);
    expect(matchBashCommandAllowlist('printf x | wc', ['exact: printf x | cat'], '/bin/zsh')).toBe(false);
    expect(matchBashCommandAllowlist('git status', ['exact: git'], '/bin/zsh')).toBe(false);
    expect(matchBashCommandAllowlist('git status', ['prefix: "git"'], '/bin/zsh')).toBe(true);
    expect(matchBashCommandAllowlist('printf x | cat', ['exact: printf x | cat'], 'cmd.exe')).toBe(true);
  });

  it('preserves POSIX double-quote backslashes instead of over-unescaping', () => {
    expect(tokenizeBashArgv('printf "a\\qb"')).toEqual(['printf', 'a\\qb']);
    expect(tokenizeBashArgv('printf "a\\\\b"')).toEqual(['printf', 'a\\b']);
  });

  it('round-trips prefix grants with shell-literal JSON-sensitive argv', () => {
    const command = "printf '$VAR' '`tick`' 'a\\\\b' 'json \"quote\"'";
    const grant = createPrefixBashGrant(command, '/bin/sh');
    expect(grant).toEqual({
      kind: 'argv-prefix',
      argv: ['printf', '$VAR', '`tick`', 'a\\\\b', 'json "quote"'],
    });
    if (!grant) throw new Error('Expected a prefix grant');

    const encoded = encodeBashGrant(grant);
    expect(decodeBashGrant(encoded, '/bin/sh')).toEqual(grant);
    expect(matchBashCommandAllowlist(command, [encoded], '/bin/sh')).toBe(true);
  });
});

import { buildLoginShellInvocation, resolveLoginShellPath } from '@pivi/obsidian-tools';

describe('login shell invocation', () => {
  const originalShell = process.env.SHELL;

  afterEach(() => {
    if (originalShell === undefined) {
      delete process.env.SHELL;
    } else {
      process.env.SHELL = originalShell;
    }
  });

  it('uses SHELL with -lc on Unix shells', () => {
    process.env.SHELL = '/bin/zsh';
    expect(resolveLoginShellPath()).toBe('/bin/zsh');
    expect(buildLoginShellInvocation('ast-grep --version', { SHELL: '/bin/zsh' })).toEqual({
      executable: '/bin/zsh',
      args: ['-lc', 'ast-grep --version'],
    });
  });

  it('uses fish -c when the login shell is fish', () => {
    expect(buildLoginShellInvocation('pwd', { SHELL: '/opt/homebrew/bin/fish' })).toEqual({
      executable: '/opt/homebrew/bin/fish',
      args: ['-c', 'pwd'],
    });
  });
});

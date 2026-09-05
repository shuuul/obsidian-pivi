import {
  classifyBashCommand,
  defaultSafeBashPermissions,
  formatBashPermissionLabel,
  matchBashPermissions,
  migrateLegacyCapabilityPermissions,
} from '@pivi/agent/tools';

function labelOf(command: string): string[] | 'unpersistable' {
  const classified = classifyBashCommand(command);
  if (!classified.persistable) return 'unpersistable';
  return classified.components.map(component => component.displayLabel);
}

function riskOf(command: string): string[] | 'unpersistable' {
  const classified = classifyBashCommand(command);
  if (!classified.persistable) return 'unpersistable';
  return classified.components.map(component => component.risk);
}

describe('classifyBashCommand', () => {
  it('recommends executable scope for single-purpose CLIs', () => {
    expect(labelOf('grep needle notes/a.md')).toEqual(['grep']);
    expect(labelOf('ls notes/a.md')).toEqual(['ls']);
    expect(riskOf('grep needle notes/a.md')).toEqual(['none']);
  });

  it('recommends a semantic second token for multi-command CLIs', () => {
    expect(labelOf('git status --short')).toEqual(['git status']);
    expect(labelOf("obsidian eval code='print(1)'")).toEqual(['obsidian eval']);
    expect(labelOf('npm run test -- foo.test.ts')).toEqual(['npm run']);
    expect(riskOf("obsidian eval code='print(1)'")).toEqual(['high']);
  });

  it('recommends executor operation or target tokens with warnings', () => {
    expect(labelOf("python3 -c 'print(1)'")).toEqual(['python3 -c']);
    expect(riskOf("python3 -c 'print(1)'")).toEqual(['high']);
    expect(labelOf("sh -c 'ls'")).toEqual(['sh -c']);
    expect(riskOf("sh -c 'ls'")).toEqual(['high']);
    expect(labelOf('npx marp slides.md')).toEqual(['npx marp']);
    expect(riskOf('npx marp slides.md')).toEqual(['executor']);
    expect(labelOf('uv run script.py')).toEqual(['uv run']);
    expect(riskOf('uv run script.py')).toEqual(['executor']);
  });

  it('strips reviewed transparent wrappers', () => {
    expect(labelOf('env FOO=1 git status')).toEqual(['git status']);
    expect(labelOf('command git status')).toEqual(['git status']);
  });

  it('keeps absolute executables on an isolated realpath and rejects unresolved relatives', () => {
    expect(labelOf('/opt/a/tool input')).toEqual(['/opt/a/tool']);
    const relative = classifyBashCommand('./bin/tool input.txt');
    expect(relative).toEqual({ persistable: false, reason: 'unresolved-relative' });
    const resolved = classifyBashCommand('./bin/tool input.txt', {
      resolver: {
        resolve: (executable) => (
          executable === './bin/tool' ? { kind: 'realpath', value: '/vault/bin/tool' } : 'unresolved'
        ),
      },
    });
    expect(resolved).toEqual({
      persistable: true,
      components: [expect.objectContaining({ displayLabel: '/vault/bin/tool' })],
    });
  });

  it('never lets an absolute realpath inherit a bare-name grant', () => {
    const grants = [{
      kind: 'executable' as const,
      executable: { kind: 'name' as const, value: 'tool' },
      enabled: true,
    }];
    expect(matchBashPermissions('tool input', grants)).toBe(true);
    expect(matchBashPermissions('/opt/a/tool input', grants)).toBe(false);
    expect(matchBashPermissions('/opt/a/tool input', [{
      kind: 'executable',
      executable: { kind: 'realpath', value: '/opt/a/tool' },
      enabled: true,
    }])).toBe(true);
  });

  it('splits safe && and pipeline commands into independent scopes', () => {
    expect(labelOf('grep a x && wc -l x')).toEqual(['grep', 'wc']);
    expect(labelOf('cat x | grep a')).toEqual(['cat', 'grep']);
  });

  it('rejects redirects, substitutions, and unsupported control syntax', () => {
    expect(labelOf('cat x > out')).toBe('unpersistable');
    expect(labelOf('$(tool)')).toBe('unpersistable');
    expect(labelOf('`tool`')).toBe('unpersistable');
    expect(labelOf('A=$X tool')).toBe('unpersistable');
    expect(labelOf('git status || true')).toBe('unpersistable');
    expect(labelOf('git status; rm -rf .')).toBe('unpersistable');
    expect(classifyBashCommand('exact: git status')).toEqual({ persistable: false, reason: 'legacy-encoding' });
    expect(classifyBashCommand('prefix: ["git"]')).toEqual({ persistable: false, reason: 'legacy-encoding' });
  });

  it('requires every classified component to match an enabled permission', () => {
    const grep = [{
      kind: 'executable' as const,
      executable: { kind: 'name' as const, value: 'grep' },
      enabled: true,
    }];
    expect(matchBashPermissions('grep needle notes/a.md', grep)).toBe(true);
    expect(matchBashPermissions('grep a x && wc -l x', grep)).toBe(false);
    expect(matchBashPermissions('grep a x && wc -l x', [
      ...grep,
      { kind: 'executable', executable: { kind: 'name', value: 'wc' }, enabled: true },
    ])).toBe(true);
    expect(matchBashPermissions('git commit', [{
      kind: 'subcommand',
      executable: { kind: 'name', value: 'git' },
      subcommand: 'status',
      enabled: true,
    }])).toBe(false);
    expect(matchBashPermissions('git status --short', [{
      kind: 'subcommand',
      executable: { kind: 'name', value: 'git' },
      subcommand: 'status',
      enabled: true,
    }])).toBe(true);
    expect(matchBashPermissions('git commit', [{
      kind: 'executable',
      executable: { kind: 'name', value: 'git' },
      enabled: true,
    }])).toBe(true);
  });

  it('does not match disabled records or default-unlisted commands', () => {
    expect(matchBashPermissions('python3 -c hi', [{
      kind: 'subcommand',
      executable: { kind: 'name', value: 'python3' },
      subcommand: '-c',
      enabled: false,
    }])).toBe(false);
    expect(matchBashPermissions('ls', defaultSafeBashPermissions())).toBe(false);
    expect(matchBashPermissions('pwd', defaultSafeBashPermissions())).toBe(true);
  });
});

describe('migrateLegacyCapabilityPermissions', () => {
  it('preserves prefix and executable-wide grants and expands exact entries without private paths', () => {
    const migrated = migrateLegacyCapabilityPermissions({
      bashAllowlist: [
        'ls',
        'grep',
        'git',
        'wc',
        'cat',
        'head',
        'tail',
        'find',
        'rg',
        'jq',
        'sed',
        'awk',
        'prefix: ["ls"]',
        'exact: ls notes/example.md',
        'exact: grep needle notes/example.md && wc -l notes/example.md',
      ],
      externalReadDirectories: ['/tmp/example-root'],
    });
    const labels = migrated.permissions.bash
      .filter(permission => permission.enabled)
      .map(permission => formatBashPermissionLabel(permission))
      .sort();
    expect(labels).toEqual([
      'awk', 'cat', 'find', 'git', 'grep', 'head', 'jq', 'ls', 'rg', 'sed', 'tail', 'wc',
    ]);
    expect(migrated.permissions.externalDirectories).toEqual([
      { realpath: '/tmp/example-root', enabled: true },
    ]);
  });

  it('disables high-risk exact expansions pending review', () => {
    const migrated = migrateLegacyCapabilityPermissions({
      bashAllowlist: ["exact: python3 -c 'print(1)'", 'prefix: ["python3"]'],
    });
    const python = migrated.permissions.bash.find(permission => (
      permission.executable.kind === 'name' && permission.executable.value === 'python3'
    ));
    expect(python).toEqual({
      kind: 'executable',
      executable: { kind: 'name', value: 'python3' },
      enabled: true,
    });
    const onlyExact = migrateLegacyCapabilityPermissions({
      bashAllowlist: ["exact: python3 -c 'print(1)'"],
    });
    expect(onlyExact.permissions.bash).toEqual([{
      kind: 'subcommand',
      executable: { kind: 'name', value: 'python3' },
      subcommand: '-c',
      enabled: false,
    }]);
  });
});

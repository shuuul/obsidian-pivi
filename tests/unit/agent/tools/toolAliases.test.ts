import {
  appendToolResultReminder,
  buildAliasReminder,
  canonicalizeToolCallName,
  isDisabledToolName,
  migrateDisabledToolNames,
  normalizeToolCallArguments,
  resolveLiveToolName,
} from '@pivi/agent/tools';

describe('toolAliases', () => {
  it('maps PascalCase, legacy obsidian_*, and extra names onto live names', () => {
    expect(resolveLiveToolName('Read')).toBe('read');
    expect(resolveLiveToolName('obsidian_read')).toBe('read');
    expect(resolveLiveToolName('obsidian_read_external')).toBe('read');
    expect(resolveLiveToolName('LS')).toBe('ls');
    expect(resolveLiveToolName('list_dir')).toBe('ls');
    expect(resolveLiveToolName('obsidian_list_external')).toBe('ls');
    expect(resolveLiveToolName('Search')).toBe('search');
    expect(resolveLiveToolName('grep')).toBe('grep');
  });

  it('migrates disabledTools onto live names once and drops bash', () => {
    expect(migrateDisabledToolNames(['obsidian_read', 'Read', 'obsidian_bash', 'bash', 'obsidian_search']))
      .toEqual(['read', 'search']);
  });

  it('treats every alias as the same disablement identity', () => {
    expect(isDisabledToolName(['read'], 'obsidian_read_external')).toBe(true);
    expect(isDisabledToolName(['obsidian_list'], 'ls')).toBe(true);
    expect(isDisabledToolName(['search'], 'grep')).toBe(false);
  });

  it('normalizes path, paging, search, bash, edit, and write aliases', () => {
    expect(normalizeToolCallArguments('read', { file_path: 'a.md', startLine: 2, endLine: 4 })).toEqual({
      args: { path: 'a.md', offset: 2, limit: 3 },
      fieldAlias: 'file_path',
    });
    expect(normalizeToolCallArguments('search', { pattern: 'needle' })).toEqual({
      args: { query: 'needle' },
      fieldAlias: 'pattern',
    });
    expect(normalizeToolCallArguments('bash', { cmd: 'pwd' })).toEqual({
      args: { command: 'pwd' },
      fieldAlias: 'cmd',
    });
    expect(normalizeToolCallArguments('edit', { path: 'a.md', old_string: 'old', new_string: 'new', replace_all: true })).toEqual({
      args: { path: 'a.md', edits: [{ oldText: 'old', newText: 'new', replaceAll: true }] },
      fieldAlias: 'old_string',
    });
    expect(normalizeToolCallArguments('write', { path: 'a.md', content: 'hi' }).args.mode).toBe('overwrite');
  });

  it('reminds the live name first, otherwise the first aliased field', () => {
    expect(buildAliasReminder('obsidian_read', { path: 'a.md' }))
      .toBe('Use the live tool name `read` next time.');
    expect(buildAliasReminder('read', { file_path: 'a.md' }))
      .toBe('Use the canonical field `path` next time.');
    expect(buildAliasReminder('read', { path: 'a.md', offset: 1, limit: 10 })).toBeUndefined();
  });

  it('persists the live name and appends one reminder to a successful result', () => {
    const toolCall = canonicalizeToolCallName({ name: 'obsidian_read', id: '1' });
    expect(toolCall.name).toBe('read');
    const reminded = appendToolResultReminder(
      { content: [{ type: 'text', text: 'ok' }] },
      'Use the live tool name `read` next time.',
    );
    expect(reminded).toEqual({
      content: [{ type: 'text', text: 'ok\n\nUse the live tool name `read` next time.' }],
    });
  });
});

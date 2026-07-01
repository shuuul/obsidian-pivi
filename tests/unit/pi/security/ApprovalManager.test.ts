import { getActionDescription, getActionPattern, matchesRulePattern } from '../../../../src/pi/security/ApprovalManager';
import { TOOL_OBSIDIAN_PROPERTIES, TOOL_OBSIDIAN_TASKS, TOOL_OBSIDIAN_WRITE } from '../../../../src/pi/tools/obsidianToolNames';
import { TOOL_BASH } from '../../../../src/pi/tools/toolNames';

describe('matchesRulePattern', () => {
  describe('obsidian_write path prefix', () => {
    it('matches paths under an approved directory prefix', () => {
      expect(matchesRulePattern(TOOL_OBSIDIAN_WRITE, 'notes/a.md', 'notes/')).toBe(true);
    });

    it('does not match similar path prefixes across segments', () => {
      expect(matchesRulePattern(TOOL_OBSIDIAN_WRITE, 'notes-extra/foo.md', 'notes/')).toBe(false);
    });

    it('matches exact path', () => {
      expect(matchesRulePattern(TOOL_OBSIDIAN_WRITE, 'notes/foo.md', 'notes/foo.md')).toBe(true);
    });
  });

  describe('bash wildcards', () => {
    it('matches git * prefix commands', () => {
      expect(matchesRulePattern(TOOL_BASH, 'git status', 'git *')).toBe(true);
    });

    it('rejects unrelated commands without wildcard', () => {
      expect(matchesRulePattern(TOOL_BASH, 'npm install', 'git status')).toBe(false);
    });
  });
});

describe('approval action formatting', () => {
  it('does not stringify object-valued action fields for obsidian properties', () => {
    expect(getActionPattern(TOOL_OBSIDIAN_PROPERTIES, { action: { bad: true } })).toBe('');
    expect(getActionDescription(TOOL_OBSIDIAN_PROPERTIES, { action: { bad: true } }))
      .toBe('Obsidian properties : ');
  });

  it('uses default labels instead of stringifying object-valued write mode', () => {
    expect(getActionDescription(TOOL_OBSIDIAN_WRITE, { mode: ['append'], path: 'notes/a.md' }))
      .toBe('Obsidian write (write): notes/a.md');
  });

  it('does not stringify object-valued action fields for obsidian tasks', () => {
    expect(getActionPattern(TOOL_OBSIDIAN_TASKS, { action: ['list'] })).toBe('');
    expect(getActionDescription(TOOL_OBSIDIAN_TASKS, { action: ['list'] }))
      .toBe('Obsidian tasks : ');
  });
});

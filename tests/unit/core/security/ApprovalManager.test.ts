import { matchesRulePattern } from '../../../../src/core/security/ApprovalManager';
import { TOOL_OBSIDIAN_WRITE } from '../../../../src/core/tools/obsidianToolNames';
import { TOOL_BASH } from '../../../../src/core/tools/toolNames';

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

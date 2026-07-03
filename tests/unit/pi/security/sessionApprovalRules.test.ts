import { SessionApprovalRules } from '@pivi/pivi-agent-core/tools/approval/sessionApprovalRules';
import { TOOL_OBSIDIAN_WRITE } from '@pivi/pivi-agent-core/tools/obsidianToolNames';

describe('SessionApprovalRules', () => {
  it('matches after add for same tool and pattern', () => {
    const rules = new SessionApprovalRules();
    rules.add(TOOL_OBSIDIAN_WRITE, 'notes/foo.md');
    expect(rules.matches(TOOL_OBSIDIAN_WRITE, 'notes/foo.md')).toBe(true);
  });

  it('does not match a different tool', () => {
    const rules = new SessionApprovalRules();
    rules.add(TOOL_OBSIDIAN_WRITE, 'notes/foo.md');
    expect(rules.matches('obsidian_properties', 'notes/foo.md')).toBe(false);
  });

  it('clear removes all rules', () => {
    const rules = new SessionApprovalRules();
    rules.add(TOOL_OBSIDIAN_WRITE, 'notes/foo.md');
    rules.clear();
    expect(rules.matches(TOOL_OBSIDIAN_WRITE, 'notes/foo.md')).toBe(false);
  });

  it('recordAlwaysAllow uses resolved pattern when provided', () => {
    const rules = new SessionApprovalRules();
    rules.recordAlwaysAllow(TOOL_OBSIDIAN_WRITE, { path: 'raw.md' }, 'notes/foo.md');
    expect(rules.matches(TOOL_OBSIDIAN_WRITE, 'notes/foo.md')).toBe(true);
  });

  it('ignores empty patterns on add', () => {
    const rules = new SessionApprovalRules();
    rules.add(TOOL_OBSIDIAN_WRITE, '   ');
    expect(rules.matches(TOOL_OBSIDIAN_WRITE, 'notes/foo.md')).toBe(false);
  });
});

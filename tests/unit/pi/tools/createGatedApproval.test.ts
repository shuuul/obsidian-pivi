import { SessionApprovalRules } from '@pivi/pivi-agent-core/tools/approval/sessionApprovalRules';
import { TOOL_OBSIDIAN_WRITE } from '@pivi/pivi-agent-core/tools/obsidianToolNames';
import { createGatedApproval } from '@pivi/pivi-agent-core/engine/pi/createGatedApproval';

describe('createGatedApproval', () => {
  it('skips callback when session rule matches', async () => {
    const rules = new SessionApprovalRules();
    rules.add(TOOL_OBSIDIAN_WRITE, 'notes/foo.md');
    const callback = jest.fn();

    const approve = createGatedApproval(
      callback,
      rules,
      () => 'notes/foo.md',
    );

    const decision = await approve!(TOOL_OBSIDIAN_WRITE, { path: 'notes/foo.md' }, 'write');
    expect(decision).toBe('allow');
    expect(callback).not.toHaveBeenCalled();
  });

  it('records allow-always from callback decision', async () => {
    const rules = new SessionApprovalRules();
    const callback = jest.fn().mockResolvedValue('allow-always');

    const approve = createGatedApproval(
      callback,
      rules,
      () => 'notes/bar.md',
    );

    await approve!(TOOL_OBSIDIAN_WRITE, { path: 'notes/bar.md' }, 'write');
    expect(rules.matches(TOOL_OBSIDIAN_WRITE, 'notes/bar.md')).toBe(true);
  });
});

import {
  buildRegisteredToolsSection,
} from '@pivi/pivi-agent-core/prompt';
import {
  TOOL_OBSIDIAN_DELETE,
  TOOL_OBSIDIAN_HISTORY,
  TOOL_OBSIDIAN_MKDIR,
  TOOL_OBSIDIAN_MOVE,
} from '@pivi/pivi-agent-core/tools';

function buildSection(overrides: Partial<Parameters<typeof buildRegisteredToolsSection>[0]> = {}): string {
  return buildRegisteredToolsSection({
    obsidianTools: [],
    includeMcp: false,
    includeSkill: false,
    includeSubagent: false,
    allowCommand: false,
    allowEval: false,
    ...overrides,
  });
}

const removedGatePhrase = ['requires', 'ap' + 'proval'].join(' ');

describe('obsidian registered tool prompt section', () => {
  it('documents obsidian_history and its recovery workflow', () => {
    const section = buildSection({ obsidianTools: [TOOL_OBSIDIAN_HISTORY] });

    expect(section).toContain('obsidian_history');
    expect(section).toContain('Use `obsidian_history` before giving up on a deleted, overwritten, or accidentally changed vault note');
    expect(section).toContain('action: "files"');
    expect(section).toContain('action: "list"');
    expect(section).toContain('action: "read"');
    expect(section).toContain('action: "restore"');
    expect(section).toContain('History restore depends on Obsidian’s stored history');
  });

  it('does not describe command or eval as gated', () => {
    const section = buildSection({ allowCommand: true, allowEval: true });

    expect(section).toContain('obsidian_command');
    expect(section).toContain('obsidian_eval');
    expect(section).not.toContain(removedGatePhrase);
  });

  it('does not describe delete move or mkdir as gated', () => {
    const section = buildSection({
      obsidianTools: [TOOL_OBSIDIAN_DELETE, TOOL_OBSIDIAN_MOVE, TOOL_OBSIDIAN_MKDIR],
    });

    expect(section).toContain('obsidian_delete');
    expect(section).toContain('obsidian_move');
    expect(section).toContain('obsidian_mkdir');
    expect(section).not.toContain(removedGatePhrase);
  });
});

import {
  normalizeWebSearchDisplayData,
} from '@pivi/pivi-agent-core/tools/toolPresentation';
import {
  TOOL_APPLY_PATCH,
  TOOL_BASH,
  TOOL_SKILL,
  TOOL_TODO_WRITE,
  TOOL_WEB_SEARCH,
  TOOL_WRITE_STDIN,
} from '@pivi/pivi-agent-core/tools/toolNames';
import {
  getToolLabel,
  getToolName,
  getToolSummary,
} from '@/ui/chat/rendering/toolPresentationI18n';

describe('toolPresentationI18n', () => {
  it('summarizes todo progress in the tool name', () => {
    const input = {
      todos: [
        { status: 'completed' },
        { status: 'in_progress' },
      ],
    };

    expect(getToolName(TOOL_TODO_WRITE, input)).toBe('Tasks 1/2');
    expect(getToolLabel(TOOL_TODO_WRITE, input)).toBe('Tasks 1/2');
  });

  it('labels skill tool calls by skill name', () => {
    const input = { name: 'defuddle', args: 'extract article' };

    expect(getToolName(TOOL_SKILL, input)).toBe('defuddle');
    expect(getToolLabel(TOOL_SKILL, input)).toBe('defuddle: extract article');
  });

  it('truncates long bash commands for labels and summaries', () => {
    const command = 'npm run test -- --runInBand tests/unit/features/chat/toolPresentationI18n.test.ts';

    const summary = getToolSummary(TOOL_BASH, { command });
    expect(summary).toHaveLength(63);
    expect(summary.endsWith('...')).toBe(true);
    expect(getToolLabel(TOOL_BASH, { command })).toBe(`Bash: ${summary}`);
  });

  it('summarizes apply_patch targets from patch text', () => {
    const patch = [
      '*** Begin Patch',
      '*** Update File: src/foo.ts',
      '@@',
      '-old',
      '+new',
      '*** Add File: src/bar.ts',
      '+hello',
      '*** End Patch',
    ].join('\n');

    expect(getToolSummary(TOOL_APPLY_PATCH, { patch })).toBe('2 files');
    expect(getToolLabel(TOOL_APPLY_PATCH, { patch })).toBe('apply_patch: 2 files');
  });

  it('summarizes write_stdin sessions and escaped input', () => {
    const input = { session_id: 'abc123', chars: 'hello\nworld' };

    expect(getToolSummary(TOOL_WRITE_STDIN, input)).toBe('#abc123 hello\\nworld');
    expect(getToolLabel(TOOL_WRITE_STDIN, input)).toBe('write_stdin: #abc123 hello\\nworld');
  });

  it('normalizes web search action metadata for rendering and labels', () => {
    const input = { url: 'https://example.com', pattern: 'needle' };

    expect(normalizeWebSearchDisplayData(input)).toEqual({
      actionType: 'find_in_page',
      pattern: 'needle',
      queries: [],
      query: '',
      url: 'https://example.com',
    });
    expect(getToolSummary(TOOL_WEB_SEARCH, input)).toBe('Find "needle" in https://example.com');
    expect(getToolLabel(TOOL_WEB_SEARCH, input)).toBe('WebSearch: Find "needle" in https://example.com');
  });
});

import type { ReactElement } from 'react';
import type { ToolCallInfo } from '@pivi/pivi-agent-core/foundation';
import { TOOL_BASH, TOOL_TODO_WRITE, TOOL_WRITE } from '@pivi/pivi-agent-core/tools/toolNames';
import { fireEvent, render, screen } from '@testing-library/react';

import { I18nProvider } from '@pivi/obsidian-ui/i18n/I18nProvider';
import { createI18n } from '@pivi/obsidian-ui/i18n/createI18n';
import { ToolCallView, ToolStepGroupView } from '@pivi/obsidian-ui/chat/messages/ToolCallView';
import { aggregateToolStatus, getToolDisplayName, groupToolCallRuns, isGroupableToolCall, shouldRenderToolCall } from '@pivi/obsidian-ui/chat/messages/toolPresentation';

function toolCall(id: string, name: string, status: ToolCallInfo['status'], input: Record<string, unknown> = {}, result?: string): ToolCallInfo {
  return { id, name, input, status, result };
}

function renderTool(ui: ReactElement) {
  return render(<I18nProvider i18n={createI18n()}>{ui}</I18nProvider>);
}

describe('ToolCallView', () => {
  it('renders a stored result only after expanding its shell', () => {
    const tool = toolCall('bash-1', TOOL_BASH, 'completed', { command: 'pwd' }, 'workspace');
    renderTool(<ToolCallView toolCall={tool} />);

    expect(screen.queryByText('workspace')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Bash: pwd' }));
    expect(screen.getByText('workspace')).toBeInTheDocument();
  });

  it('keeps repeated tool inputs as distinct, ordered rows with raw tool names', () => {
    const first = toolCall('bash-1', TOOL_BASH, 'completed', { command: 'pwd' }, 'first');
    const second = toolCall('bash-2', TOOL_BASH, 'completed', { command: 'pwd' }, 'second');
    renderTool(<ToolStepGroupView toolCalls={[first, second]} />);

    fireEvent.click(screen.getByRole('button', { name: /2 steps/ }));
    expect(screen.getAllByText('Bash')).toHaveLength(2);
    expect(document.querySelectorAll('.pivi-tool-call-in-step-group')).toHaveLength(2);
    expect([...document.querySelectorAll('[data-tool-id]')].map(row => row.getAttribute('data-tool-id')))
      .toEqual(['bash-1', 'bash-2']);
  });

  it('aggregates running, blocked, error, and completed statuses with running precedence', () => {
    expect(aggregateToolStatus([
      toolCall('done', TOOL_BASH, 'completed'),
      toolCall('blocked', TOOL_BASH, 'blocked'),
    ])).toBe('error');
    expect(aggregateToolStatus([
      toolCall('error', TOOL_BASH, 'error'),
      toolCall('running', TOOL_BASH, 'running'),
    ])).toBe('running');
  });

  it('splits step groups around specialized tool shells without reordering calls', () => {
    const first = toolCall('one', TOOL_BASH, 'completed');
    const todo = toolCall('todo', TOOL_TODO_WRITE, 'completed');
    const write = toolCall('write', TOOL_WRITE, 'completed', { file_path: 'a.md' });
    const last = toolCall('two', TOOL_BASH, 'completed');

    expect(isGroupableToolCall(write)).toBe(false);
    expect(groupToolCallRuns([first, todo, write, last])).toEqual([
      { kind: 'group', toolCalls: [first] },
      { kind: 'single', toolCall: todo },
      { kind: 'single', toolCall: write },
      { kind: 'group', toolCalls: [last] },
    ]);
  });

  it('uses display helpers for tool titles instead of step phrases', () => {
    const i18n = createI18n();
    expect(getToolDisplayName(toolCall('bash', TOOL_BASH, 'completed', { command: 'ls' }), i18n.t)).toBe('Bash');
    expect(getToolDisplayName(toolCall('todo', TOOL_TODO_WRITE, 'completed', {
      todos: [{ status: 'completed' }, { status: 'pending' }],
    }), i18n.t)).toBe('Tasks 1/2');
  });

  it('renders collapsible chevrons and visible step-group latest summary', () => {
    const tool = toolCall('bash-1', TOOL_BASH, 'completed', { command: 'pwd' }, 'workspace');
    renderTool(<ToolCallView toolCall={tool} />);
    const individualChevron = document.querySelector('.pivi-tool-header .pivi-collapsible-chevron');
    expect(individualChevron).toHaveClass('is-collapsed');
    fireEvent.click(screen.getByRole('button', { name: 'Bash: pwd' }));
    expect(document.querySelector('.pivi-tool-call')).toHaveClass('expanded');
    expect(document.querySelector('.pivi-tool-header .pivi-collapsible-chevron')).not.toHaveClass('is-collapsed');
  });

  it('shows step-group latest summary and rotates the group chevron', () => {
    const first = toolCall('bash-1', TOOL_BASH, 'completed', { command: 'pwd' }, 'first');
    const second = toolCall('bash-2', TOOL_BASH, 'completed', { command: 'ls' }, 'second');
    renderTool(<ToolStepGroupView toolCalls={[first, second]} />);
    expect(document.querySelector('.pivi-tool-step-group-summary')?.textContent).toBeTruthy();
    const groupChevron = document.querySelector('.pivi-tool-step-group-header .pivi-collapsible-chevron');
    expect(groupChevron).toHaveClass('is-collapsed');
    fireEvent.click(screen.getByRole('button', { name: /2 steps/ }));
    expect(document.querySelector('.pivi-tool-step-group')).toHaveClass('expanded');
    expect(document.querySelector('.pivi-tool-step-group-header .pivi-collapsible-chevron')).not.toHaveClass('is-collapsed');
  });

  it('excludes hidden tools from groupable membership', () => {
    expect(isGroupableToolCall(toolCall('out', 'TaskOutput', 'completed'))).toBe(false);
    expect(isGroupableToolCall(toolCall('stdin', 'write_stdin', 'completed', {}))).toBe(false);
    expect(isGroupableToolCall(toolCall('custom', 'custom_tool_call_output', 'completed'))).toBe(false);
    expect(shouldRenderToolCall(toolCall('out', 'TaskOutput', 'completed'))).toBe(false);
    expect(shouldRenderToolCall(toolCall('bash', TOOL_BASH, 'completed'))).toBe(true);
  });
});

import type { ReactElement } from 'react';
import type { ToolCallInfo } from '@pivi/pivi-agent-core/foundation';
import {
  TOOL_OBSIDIAN_EDIT,
  TOOL_OBSIDIAN_SEARCH,
} from '@pivi/pivi-agent-core/tools/obsidianToolNames';
import {
  TOOL_BASH,
  TOOL_MCP,
  TOOL_TODO_WRITE,
  TOOL_WEB_SEARCH,
  TOOL_WRITE,
} from '@pivi/pivi-agent-core/tools/toolNames';
import { act, fireEvent, render, screen } from '@testing-library/react';

import {
  aggregateToolStatus,
  ChatProjectionStore,
  createI18n,
  getToolDisplayName,
  groupToolCallRuns,
  I18nProvider,
  isGroupableToolCall,
  shouldRenderToolCall,
  ToolCallView,
  ToolStepGroupView,
} from '@pivi/pivi-react';

import { withTestPresentationPlatform } from '../helpers/presentationPlatform';

function toolCall(id: string, name: string, status: ToolCallInfo['status'], input: Record<string, unknown> = {}, result?: string): ToolCallInfo {
  return { id, name, input, status, result };
}

function renderTool(ui: ReactElement) {
  return render(withTestPresentationPlatform(
    <I18nProvider i18n={createI18n()}>{ui}</I18nProvider>,
  ));
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
    expect(document.querySelectorAll('.pivi-tool-call-in-step-group .pivi-tool-name')).toHaveLength(2);
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

  it('keeps Write and Obsidian edit inside groups split by specialized tool shells', () => {
    const first = toolCall('one', TOOL_BASH, 'completed');
    const todo = toolCall('todo', TOOL_TODO_WRITE, 'completed');
    const write = toolCall('write', TOOL_WRITE, 'completed', { file_path: 'a.md' });
    const obsidianEdit = toolCall('obsidian-edit', TOOL_OBSIDIAN_EDIT, 'completed', { path: 'b.md' });
    const last = toolCall('two', TOOL_BASH, 'completed');

    expect(isGroupableToolCall(write)).toBe(true);
    expect(isGroupableToolCall(obsidianEdit)).toBe(true);
    expect(groupToolCallRuns([first, todo, write, obsidianEdit, last])).toEqual([
      { kind: 'group', toolCalls: [first] },
      { kind: 'single', toolCall: todo },
      { kind: 'group', toolCalls: [write, obsidianEdit, last] },
    ]);
  });

  it('uses one generic shell for Edit and keeps diff stats in its header', () => {
    const edit: ToolCallInfo = {
      ...toolCall('edit-1', TOOL_OBSIDIAN_EDIT, 'completed', { path: 'note.md' }),
      diffData: {
        filePath: 'note.md',
        diffLines: [{ type: 'insert', text: 'New line' }],
        stats: { added: 1, removed: 0 },
      },
    };
    const toolAdapter = {
      mount(container: HTMLElement) {
        const preview = container.ownerDocument.createElement('div');
        preview.className = 'edit-preview';
        preview.textContent = 'New line';
        container.appendChild(preview);
      },
    };

    renderTool(<ToolCallView toolCall={edit} contentAdapters={{ tool: toolAdapter }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit: edit · note.md' }));

    expect(document.querySelectorAll('.pivi-tool-call')).toHaveLength(1);
    expect(document.querySelectorAll('.pivi-tool-header')).toHaveLength(1);
    expect(document.querySelector('.pivi-write-edit-block')).not.toBeInTheDocument();
    expect(document.querySelector('.pivi-write-edit-header')).not.toBeInTheDocument();
    expect(document.querySelector('.pivi-write-edit-stats')).toHaveTextContent('+1');
    expect(document.querySelector('.edit-preview')).toHaveTextContent('New line');
  });

  it('uses display helpers for tool titles instead of step phrases', () => {
    const i18n = createI18n();
    expect(getToolDisplayName(toolCall('bash', TOOL_BASH, 'completed', { command: 'ls' }), i18n.t)).toBe('Bash');
    expect(getToolDisplayName(toolCall('todo', TOOL_TODO_WRITE, 'completed', {
      todos: [{ status: 'completed' }, { status: 'pending' }],
    }), i18n.t)).toBe('Tasks 1/2');
  });

  it('renders MCP proxy calls with the MCP icon and server/tool title', () => {
    renderTool(<ToolCallView toolCall={toolCall(
      'mcp-1',
      TOOL_MCP,
      'completed',
      { server: 'exa', tool: 'search' },
    )} />);

    expect(document.querySelector('.pivi-tool-icon svg title')).toHaveTextContent('MCP');
    expect(document.querySelector('.pivi-tool-name')).toHaveTextContent('exa/search');
    expect(screen.getByRole('button', { name: 'exa/search' })).toBeInTheDocument();
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

  it('uses completed Obsidian search results in the header summary and aria label', () => {
    const result = JSON.stringify([{ path: 'month/2026-2.md', line: 7 }]);
    const search = toolCall(
      'search-1',
      TOOL_OBSIDIAN_SEARCH,
      'completed',
      { query: '*', path: 'month' },
      result,
    );

    renderTool(<ToolCallView toolCall={search} />);

    expect(screen.getByText('Search')).toBeInTheDocument();
    expect(screen.getByText('* · month · month/2026-2.md:7')).toBeInTheDocument();
    expect(screen.getByRole('button', {
      name: 'Search: * · month · month/2026-2.md:7',
    })).toBeInTheDocument();
  });

  it('keeps descriptor-owned Bash and web CSS classes', () => {
    renderTool(<>
      <ToolCallView toolCall={toolCall('bash-class', TOOL_BASH, 'completed')} />
      <ToolCallView toolCall={toolCall('web-class', TOOL_WEB_SEARCH, 'completed')} />
    </>);

    expect(document.querySelector('[data-tool-id="bash-class"]')).toHaveClass('pivi-tool-call-bash');
    expect(document.querySelector('[data-tool-id="web-class"]')).toHaveClass('pivi-tool-call-web');
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
    const hidden = toolCall('out', 'TaskOutput', 'completed');
    expect(isGroupableToolCall(hidden)).toBe(false);
    expect(isGroupableToolCall(toolCall('stdin', 'write_stdin', 'completed', {}))).toBe(false);
    expect(isGroupableToolCall(toolCall('custom', 'custom_tool_call_output', 'completed'))).toBe(false);
    expect(shouldRenderToolCall(toolCall('out', 'TaskOutput', 'completed'))).toBe(false);
    expect(shouldRenderToolCall(toolCall('bash', TOOL_BASH, 'completed'))).toBe(true);
    expect(groupToolCallRuns([
      toolCall('before', TOOL_BASH, 'completed'),
      hidden,
      toolCall('after', TOOL_BASH, 'completed'),
    ])).toEqual([{
      kind: 'group',
      toolCalls: [
        toolCall('before', TOOL_BASH, 'completed'),
        toolCall('after', TOOL_BASH, 'completed'),
      ],
    }]);
  });

  it('rerenders only the projected tool whose entity changes', () => {
    const first = toolCall('bash-1', TOOL_BASH, 'running', { command: 'pwd' });
    const second = toolCall('bash-2', TOOL_BASH, 'running', { command: 'ls' });
    const store = new ChatProjectionStore();
    store.replaceAll([{
      id: 'assistant-1',
      role: 'assistant',
      content: '',
      timestamp: 1,
      toolCalls: [first, second],
    }]);
    const renders: string[] = [];
    const contentAdapters = {
      renderToolContent(tool: ToolCallInfo) {
        renders.push(`${tool.id}:${tool.status}`);
        return <span>{tool.id}</span>;
      },
    };
    renderTool(<>
      <ToolCallView contentAdapters={contentAdapters} projectionStore={store} toolId={first.id} />
      <ToolCallView contentAdapters={contentAdapters} projectionStore={store} toolId={second.id} />
    </>);
    fireEvent.click(screen.getByRole('button', { name: 'Bash: pwd' }));
    fireEvent.click(screen.getByRole('button', { name: 'Bash: ls' }));
    renders.length = 0;

    act(() => store.upsertNow({
      id: 'assistant-1',
      role: 'assistant',
      content: '',
      timestamp: 1,
      toolCalls: [{ ...first, status: 'completed' }, second],
    }));

    expect(renders).toEqual(['bash-1:completed']);
    expect(document.querySelector('[data-tool-id="bash-1"] .pivi-tool-status')).toHaveClass('status-completed');
    expect(document.querySelector('[data-tool-id="bash-2"] .pivi-tool-status')).toHaveClass('status-running');
  });

  it('updates projected group aggregate status when any member changes', () => {
    const first = toolCall('bash-1', TOOL_BASH, 'completed', { command: 'pwd' });
    const second = toolCall('bash-2', TOOL_BASH, 'running', { command: 'ls' });
    const store = new ChatProjectionStore();
    store.replaceAll([{
      id: 'assistant-1',
      role: 'assistant',
      content: '',
      timestamp: 1,
      toolCalls: [first, second],
    }]);
    const renders: string[] = [];
    const contentAdapters = {
      renderToolContent(tool: ToolCallInfo) {
        renders.push(`${tool.id}:${tool.status}`);
        return <span>{tool.id}</span>;
      },
    };
    renderTool(
      <ToolStepGroupView
        contentAdapters={contentAdapters}
        projectionStore={store}
        toolIds={[first.id, second.id]}
      />,
    );
    expect(document.querySelector('.pivi-tool-step-group-status')).toHaveClass('status-running');
    fireEvent.click(screen.getByRole('button', { name: /2 steps/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Bash: pwd' }));
    fireEvent.click(screen.getByRole('button', { name: 'Bash: ls' }));
    renders.length = 0;

    act(() => store.upsertNow({
      id: 'assistant-1',
      role: 'assistant',
      content: '',
      timestamp: 1,
      toolCalls: [first, { ...second, status: 'completed' }],
    }));

    expect(document.querySelector('.pivi-tool-step-group-status')).toHaveClass('status-completed');
    expect(renders).toEqual(['bash-2:completed']);
  });

  it('updates an imperative projected tool adapter without remounting it', () => {
    const first = toolCall('bash-1', TOOL_BASH, 'running', { command: 'pwd' });
    const store = new ChatProjectionStore();
    store.replaceAll([{
      id: 'assistant-1',
      role: 'assistant',
      content: '',
      timestamp: 1,
      toolCalls: [first],
    }]);
    const mounts: string[] = [];
    const updates: string[] = [];
    const tool = {
      mount(container: HTMLElement, value: ToolCallInfo) {
        mounts.push(value.id);
        container.textContent = value.status;
      },
      update(container: HTMLElement, value: ToolCallInfo) {
        updates.push(value.status);
        container.textContent = value.status;
      },
    };
    renderTool(
      <ToolCallView
        contentAdapters={{ tool }}
        projectionStore={store}
        toolId={first.id}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Bash: pwd' }));

    act(() => store.upsertNow({
      id: 'assistant-1',
      role: 'assistant',
      content: '',
      timestamp: 1,
      toolCalls: [{ ...first, status: 'completed' }],
    }));

    expect(mounts).toEqual(['bash-1']);
    expect(updates).toEqual(['completed']);
    expect(document.querySelector('.pivi-tool-content-adapter')).toHaveTextContent('completed');
  });
});

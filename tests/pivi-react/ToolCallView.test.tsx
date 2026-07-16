import type { ReactElement } from 'react';
import type { ActivityStatus, ToolCallInfo } from '@pivi/pivi-agent-core/foundation';
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
import type { ChatProjectionEvent } from '@pivi/pivi-react/store';

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

function queuedMessageEvent(
  message: Extract<ChatProjectionEvent, { type: 'message.upsert' }>['message'],
): ChatProjectionEvent {
  return {
    type: 'message.upsert',
    projectionScopeId: 'test',
    sessionFile: null,
    openSessionId: null,
    runId: 'test:run:1',
    parentRunId: null,
    sequence: 1,
    timestamp: 1,
    messageId: message.id,
    blockId: null,
    toolId: null,
    agentId: null,
    message,
    delivery: 'queued',
  };
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
    ])).toBe('failed');
    expect(aggregateToolStatus([
      toolCall('error', TOOL_BASH, 'error'),
      toolCall('running', TOOL_BASH, 'running'),
    ])).toBe('running');
  });

  it('renders every localized activity state and animates only running', () => {
    const statuses: readonly ActivityStatus[] = [
      'queued',
      'running',
      'waiting',
      'completed',
      'failed',
      'cancelled',
      'orphaned',
    ];
    renderTool(<>{statuses.map((activityStatus, index) => (
      <ToolCallView
        key={activityStatus}
        toolCall={{
          ...toolCall(`tool-${index}`, TOOL_BASH, activityStatus === 'completed' ? 'completed' : 'error'),
          activityStatus,
        }}
      />
    ))}</>);

    expect(statuses.map(status => document.querySelector(`.pivi-tool-status.status-${status}`)?.textContent))
      .toEqual(['Queued', 'Running', 'Waiting', 'Completed', 'Failed', 'Cancelled', 'Orphaned']);
    expect(document.querySelectorAll('.pivi-working-icon-arc')).toHaveLength(1);
    expect(document.querySelectorAll('.pivi-tool-status[aria-live="polite"]')).toHaveLength(7);
    expect(document.querySelector('.pivi-tool-status.status-orphaned')).toHaveAttribute(
      'aria-label',
      expect.stringContaining('Start it again to recover'),
    );
  });

  it('updates the polite status region at phase and terminal transitions', () => {
    const wrap = (activityStatus: ActivityStatus) => withTestPresentationPlatform(
      <I18nProvider i18n={createI18n()}>
        <ToolCallView toolCall={{
          ...toolCall('phase', TOOL_BASH, activityStatus === 'completed' ? 'completed' : 'running'),
          activityStatus,
        }} />
      </I18nProvider>,
    );
    const view = render(wrap('queued'));
    const liveRegion = () => view.container.querySelector('.pivi-activity-status[aria-live="polite"]');

    expect(liveRegion()).toHaveTextContent('Queued');
    view.rerender(wrap('running'));
    expect(liveRegion()).toHaveTextContent('Running');
    view.rerender(wrap('completed'));
    expect(liveRegion()).toHaveTextContent('Completed');
  });

  it('uses the row owner window for elapsed time and freezes at completion', () => {
    jest.useFakeTimers();
    jest.setSystemTime(10_000);
    const iframe = document.createElement('iframe');
    document.body.appendChild(iframe);
    const ownerDocument = iframe.contentDocument;
    const ownerWindow = iframe.contentWindow;
    expect(ownerDocument).not.toBeNull();
    expect(ownerWindow).not.toBeNull();
    if (!ownerDocument || !ownerWindow) return;
    let tick: (() => void) | undefined;
    const setIntervalSpy = jest.spyOn(ownerWindow, 'setInterval').mockImplementation((handler) => {
      if (typeof handler === 'function') tick = () => handler();
      return 1;
    });
    const clearIntervalSpy = jest.spyOn(ownerWindow, 'clearInterval').mockImplementation(() => {});
    const container = ownerDocument.createElement('div');
    ownerDocument.body.appendChild(container);
    const view = render(withTestPresentationPlatform(
      <I18nProvider i18n={createI18n()}>
        <ToolCallView toolCall={{
          ...toolCall('timed', TOOL_BASH, 'running'),
          startedAt: 8_000,
        }} />
      </I18nProvider>,
    ), { container });

    expect(setIntervalSpy).toHaveBeenCalledTimes(1);
    expect(ownerDocument.querySelector('.pivi-activity-elapsed')).toHaveTextContent('2s');
    jest.setSystemTime(11_000);
    act(() => tick?.());
    expect(ownerDocument.querySelector('.pivi-activity-elapsed')).toHaveTextContent('3s');

    view.rerender(withTestPresentationPlatform(
      <I18nProvider i18n={createI18n()}>
        <ToolCallView toolCall={{
          ...toolCall('timed', TOOL_BASH, 'completed'),
          completedAt: 11_000,
          startedAt: 8_000,
        }} />
      </I18nProvider>,
    ));
    jest.setSystemTime(16_000);
    act(() => tick?.());
    expect(ownerDocument.querySelector('.pivi-activity-elapsed')).toHaveTextContent('3s');
    expect(ownerDocument.querySelector('.pivi-activity-elapsed')).toHaveAttribute('aria-hidden', 'true');

    view.unmount();
    expect(clearIntervalSpy).toHaveBeenCalledWith(1);
    setIntervalSpy.mockRestore();
    clearIntervalSpy.mockRestore();
    iframe.remove();
    jest.useRealTimers();
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
    expect(document.querySelector('.pivi-tool-step-group-status')).toHaveTextContent('2 Completed');
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

  it('updates projected group status counts when any member changes', () => {
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
    const initialStatus = document.querySelector('.pivi-tool-step-group-status');
    expect(initialStatus).toHaveTextContent('1 Completed/1 Running');
    expect(initialStatus?.querySelector('.status-completed')).not.toBeNull();
    expect(initialStatus?.querySelector('.status-running')).not.toBeNull();
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

    const completedStatus = document.querySelector('.pivi-tool-step-group-status');
    expect(completedStatus).toHaveTextContent('2 Completed');
    expect(completedStatus?.querySelectorAll('.pivi-tool-status')).toHaveLength(1);
    expect(completedStatus?.querySelector('.status-completed')).not.toBeNull();
    expect(renders).toEqual(['bash-2:completed']);
  });

  it('shows completed and failed step counts separately', () => {
    const completed = toolCall('bash-1', TOOL_BASH, 'completed', { command: 'pwd' });
    const failed = toolCall('bash-2', TOOL_BASH, 'error', { command: 'false' });

    renderTool(<ToolStepGroupView toolCalls={[completed, failed]} />);

    const status = document.querySelector('.pivi-tool-step-group-status');
    expect(status).toHaveTextContent('1 Completed/1 Failed');
    expect(status).toHaveAttribute('aria-label', '1 Completed / 1 Failed');
    expect(status?.querySelector('.status-completed')).not.toBeNull();
    expect(status?.querySelector('.status-failed')).not.toBeNull();
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

  it('updates only the patched projected subagent adapter without remounting', () => {
    const subagentTool = (toolId: string, agentId: string): ToolCallInfo => ({
      id: toolId,
      name: 'spawn_agent',
      input: {},
      status: 'running',
      subagent: {
        id: `subagent-${agentId}`,
        agentId,
        description: agentId,
        isExpanded: false,
        status: 'running',
        toolCalls: [],
      },
    });
    const first = subagentTool('tool-1', 'agent-1');
    const second = subagentTool('tool-2', 'agent-2');
    const store = new ChatProjectionStore();
    store.replaceAll([{
      id: 'assistant-1',
      role: 'assistant',
      content: '',
      timestamp: 1,
      toolCalls: [first, second],
    }]);
    const mounts: string[] = [];
    const updates: string[] = [];
    const subagent = {
      mount(_container: HTMLElement, value: NonNullable<ToolCallInfo['subagent']>) {
        mounts.push(value.agentId ?? value.id);
      },
      update(_container: HTMLElement, value: NonNullable<ToolCallInfo['subagent']>) {
        updates.push(`${value.agentId ?? value.id}:${value.description}`);
      },
    };
    renderTool(<>
      <ToolCallView contentAdapters={{ subagent }} projectionStore={store} toolId={first.id} />
      <ToolCallView contentAdapters={{ subagent }} projectionStore={store} toolId={second.id} />
    </>);

    act(() => {
      store.dispatch(queuedMessageEvent({
        id: 'assistant-1',
        role: 'assistant',
        content: '',
        timestamp: 1,
        toolCalls: [{
          ...first,
          subagent: { ...first.subagent!, description: 'Updated' },
        }, second],
      }));
      store.flush();
    });

    expect(mounts).toEqual(['agent-1', 'agent-2']);
    expect(updates).toEqual(['agent-1:Updated']);
  });
});

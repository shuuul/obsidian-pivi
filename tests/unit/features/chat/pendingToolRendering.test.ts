import { TOOL_TODO_WRITE, TOOL_WRITE } from '@pivi/pivi-agent-core/tools/toolNames';
import type { ChatMessage, ToolCallInfo } from '@pivi/pivi-agent-core/foundation';
import { PendingToolRendering } from '@/ui/chat/stream/PendingToolPresenter';
import { renderToolCall } from '@/ui/chat/rendering/ToolCallRenderer';
import { createWriteEditBlock } from '@/ui/chat/rendering/WriteEditRenderer';
import { ChatState } from '@/ui/chat/state/ChatState';

jest.mock('@/ui/chat/rendering/ToolCallRenderer', () => ({
  getToolName: jest.fn((_name: string, input: Record<string, unknown>) => `name:${String(input.file_path ?? input.path ?? '')}`),
  getToolSummary: jest.fn((_name: string, input: Record<string, unknown>) => `summary:${String(input.file_path ?? input.path ?? '')}`),
  renderToolCall: jest.fn((parentEl: FakeElement, toolCall: ToolCallInfo, toolCallElements: Map<string, HTMLElement>) => {
    const toolEl = parentEl.createDiv({ cls: 'pivi-tool-call' });
    toolEl.dataset.toolId = toolCall.id;
    toolCallElements.set(toolCall.id, toolEl as unknown as HTMLElement);
    return toolEl;
  }),
}));

jest.mock('@/ui/chat/rendering/WriteEditRenderer', () => ({
  createWriteEditBlock: jest.fn((parentEl: FakeElement, toolCall: ToolCallInfo) => {
    const wrapperEl = parentEl.createDiv({ cls: 'pivi-write-edit-block' });
    wrapperEl.dataset.toolId = toolCall.id;
    return {
      wrapperEl: wrapperEl as unknown as HTMLElement,
      contentEl: wrapperEl as unknown as HTMLElement,
      headerEl: wrapperEl as unknown as HTMLElement,
      nameEl: wrapperEl as unknown as HTMLElement,
      summaryEl: wrapperEl as unknown as HTMLElement,
      statsEl: wrapperEl as unknown as HTMLElement,
      statusEl: wrapperEl as unknown as HTMLElement,
      toolCall,
      isExpanded: false,
    };
  }),
}));

const mockRenderToolCall = jest.mocked(renderToolCall);
const mockCreateWriteEditBlock = jest.mocked(createWriteEditBlock);

class FakeElement {
  children: FakeElement[] = [];
  dataset: Record<string, string> = {};
  text = '';
  private classes = new Set<string>();

  constructor(cls = '') {
    for (const name of cls.split(/\s+/).filter(Boolean)) {
      this.classes.add(name);
    }
  }

  createDiv(options?: { cls?: string; text?: string }): FakeElement {
    return this.appendChild(options);
  }

  setText(text: string): void {
    this.text = text;
  }

  querySelector(selector: string): FakeElement | null {
    if (!selector.startsWith('.')) {
      return null;
    }
    return this.findByClass(selector.slice(1)) ?? null;
  }

  findByClass(className: string): FakeElement | undefined {
    if (this.classes.has(className)) return this;
    for (const child of this.children) {
      const result = child.findByClass(className);
      if (result) return result;
    }
    return undefined;
  }

  private appendChild(options?: { cls?: string; text?: string }): FakeElement {
    const child = new FakeElement(options?.cls);
    child.text = options?.text ?? '';
    this.children.push(child);
    return child;
  }
}

function createMessage(): ChatMessage {
  return {
    id: 'm1',
    role: 'assistant',
    content: '',
    timestamp: 0,
  };
}

function createHarness(): {
  state: ChatState;
  renderer: PendingToolRendering;
  parentEl: FakeElement;
  capturePlanFilePath: jest.Mock;
  showThinkingIndicator: jest.Mock;
  scheduleToolOutputRender: jest.Mock;
} {
  const state = new ChatState();
  const parentEl = new FakeElement();
  state.currentContentEl = parentEl as unknown as HTMLElement;
  const capturePlanFilePath = jest.fn();
  const showThinkingIndicator = jest.fn();
  const scheduleToolOutputRender = jest.fn();

  const renderer = new PendingToolRendering({
    state,
    capturePlanFilePath,
    showThinkingIndicator,
    scheduleToolOutputRender,
  });

  return {
    state,
    renderer,
    parentEl,
    capturePlanFilePath,
    showThinkingIndicator,
    scheduleToolOutputRender,
  };
}

describe('PendingToolRendering', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders regular tool use immediately in insertion order', () => {
    const { state, renderer, parentEl, showThinkingIndicator } = createHarness();
    const msg = createMessage();

    renderer.handleRegularToolUse({ type: 'tool_use', id: 'a', name: 'Read', input: { path: 'a.md' } }, msg);
    renderer.handleRegularToolUse({ type: 'tool_use', id: 'b', name: 'Read', input: { path: 'b.md' } }, msg);

    expect(msg.contentBlocks).toEqual([
      { type: 'tool_use', toolId: 'a' },
      { type: 'tool_use', toolId: 'b' },
    ]);
    expect(state.pendingTools.size).toBe(0);
    expect(showThinkingIndicator).toHaveBeenCalledTimes(2);
    expect(state.toolCallElements.get('a')).toBe(parentEl.children[0]);
    expect(state.toolCallElements.get('b')).toBe(parentEl.children[1]);
    expect(mockRenderToolCall.mock.calls.map(([, toolCall]) => toolCall.id)).toEqual(['a', 'b']);
  });

  it('renders write tools into write/edit state and captures plan paths', () => {
    const { state, renderer, capturePlanFilePath } = createHarness();
    const msg = createMessage();

    renderer.handleRegularToolUse({
      type: 'tool_use',
      id: 'write-1',
      name: TOOL_WRITE,
      input: { file_path: '.pivi/plans/plan.md' },
    }, msg);
    renderer.renderPendingTool('write-1');

    expect(capturePlanFilePath).toHaveBeenCalledWith({ file_path: '.pivi/plans/plan.md' });
    expect(mockCreateWriteEditBlock).toHaveBeenCalled();
    expect(state.writeEditStates.has('write-1')).toBe(true);
    expect(state.toolCallElements.has('write-1')).toBe(true);
  });

  it('schedules streamed output updates for already rendered tool use', () => {
    const { state, renderer, scheduleToolOutputRender, showThinkingIndicator } = createHarness();
    const msg = createMessage();

    renderer.handleRegularToolUse({ type: 'tool_use', id: 'bash-1', name: 'Bash', input: { command: 'ls' } }, msg);
    renderer.handleToolOutput({ type: 'tool_output', id: 'bash-1', content: 'one' }, msg);
    renderer.handleToolOutput({ type: 'tool_output', id: 'bash-1', content: '\ntwo' }, msg);

    expect(state.pendingTools.has('bash-1')).toBe(false);
    expect(msg.toolCalls?.[0].result).toBe('one\ntwo');
    expect(scheduleToolOutputRender).toHaveBeenCalledTimes(2);
    expect(scheduleToolOutputRender).toHaveBeenLastCalledWith('bash-1', msg.toolCalls?.[0]);
    expect(showThinkingIndicator).toHaveBeenCalledTimes(3);
  });

  it('updates rendered headers and todo state when streamed input is merged', () => {
    const { state, renderer } = createHarness();
    const msg = createMessage();

    renderer.handleRegularToolUse({
      type: 'tool_use',
      id: 'todo-1',
      name: TOOL_TODO_WRITE,
      input: {},
    }, msg);
    const toolEl = state.toolCallElements.get('todo-1') as unknown as FakeElement;
    const nameEl = toolEl.createDiv({ cls: 'pivi-tool-name' });
    const summaryEl = toolEl.createDiv({ cls: 'pivi-tool-summary' });
    renderer.handleRegularToolUse({
      type: 'tool_use',
      id: 'todo-1',
      name: TOOL_TODO_WRITE,
      input: {
        todos: [{ content: 'Run tests', activeForm: 'Running tests', status: 'in_progress' }],
      },
    }, msg);

    expect(state.currentTodos).toEqual([
      {
        id: 'todo-1-run-tests',
        content: 'Run tests',
        activeForm: 'Running tests',
        status: 'in_progress',
        sourceToolCallId: 'todo-1',
      },
    ]);
    expect(nameEl.text).toBe('name:');
    expect(summaryEl.text).toBe('summary:');
  });
});

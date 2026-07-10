import { TOOL_TODO_WRITE, TOOL_WRITE } from '@pivi/pivi-agent-core/tools/toolNames';
import type { ChatMessage, ToolCallInfo } from '@pivi/pivi-agent-core/foundation';
import { PendingToolRendering } from '@/ui/chat/stream/PendingToolPresenter';
import { closeStreamingToolStepGroup } from '@/ui/chat/stream/streamToolStepGroupBoundary';
import { TextStreamPresenter } from '@/ui/chat/stream/TextStreamPresenter';
import { ThinkingStreamPresenter } from '@/ui/chat/stream/ThinkingStreamPresenter';

import { renderToolCall } from '@/ui/chat/rendering/ToolCallRenderer';
import { createWriteEditBlock } from '@/ui/chat/rendering/WriteEditRenderer';
import { ChatState } from '@/ui/chat/state/ChatState';

jest.mock('@/ui/chat/rendering/markdownContentCleanup', () => ({
  stripLeadingWhitespaceForNewTextBlock: (text: string) => text.replace(/^\s+/, ''),
  trimEmptyEdgeParagraphs: jest.fn(),
}));


jest.mock('@/ui/chat/rendering/ToolCallRenderer', () => ({
  getToolName: jest.fn((_name: string, input: Record<string, unknown>) => `name:${String(input.file_path ?? input.path ?? '')}`),
  getToolSummary: jest.fn((_name: string, input: Record<string, unknown>) => `summary:${String(input.file_path ?? input.path ?? '')}`),
  renderToolCall: jest.fn((parentEl: FakeElement, toolCall: ToolCallInfo, toolCallElements: Map<string, HTMLElement>) => {
    const toolEl = parentEl.createDiv({ cls: 'pivi-tool-call' });
    toolEl.dataset.toolId = toolCall.id;
    toolCallElements.set(toolCall.id, toolEl as unknown as HTMLElement);
    return toolEl;
  }),
  renderStoredToolCall: jest.fn((parentEl: FakeElement, toolCall: ToolCallInfo) => {
    const toolEl = parentEl.createDiv({ cls: 'pivi-tool-call' });
    toolEl.dataset.toolId = toolCall.id;
    return toolEl as unknown as HTMLElement;
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
  attributes: Record<string, string> = {};
  text = '';
  parentElement: FakeElement | null = null;
  private classes = new Set<string>();

  constructor(cls = '') {
    for (const name of cls.split(/\s+/).filter(Boolean)) {
      this.classes.add(name);
    }
  }

  get classList() {
    return {
      add: (...names: string[]) => names.forEach((n) => this.addClass(n)),
      remove: (...names: string[]) => names.forEach((n) => this.removeClass(n)),
      contains: (n: string) => this.classes.has(n),
    };
  }

  addClass(cls: string): void {
    for (const name of cls.split(/\s+/).filter(Boolean)) {
      this.classes.add(name);
    }
  }

  removeClass(...classes: string[]): void {
    for (const cls of classes) {
      for (const name of cls.split(/\s+/).filter(Boolean)) {
        this.classes.delete(name);
      }
    }
  }

  toggleClass(cls: string, active: boolean): void {
    if (active) {
      this.addClass(cls);
    } else {
      this.removeClass(cls);
    }
  }

  createDiv(options?: { cls?: string; text?: string }): FakeElement {
    return this.appendNew(options);
  }

  createSpan(options?: { cls?: string; text?: string }): FakeElement {
    return this.appendNew(options);
  }

  createSvg(
    _tag: string,
    options?: { cls?: string; text?: string; attr?: Record<string, string> },
  ): FakeElement {
    const child = this.appendNew(options);
    for (const [name, value] of Object.entries(options?.attr ?? {})) {
      child.setAttribute(name, value);
    }
    return child;
  }

  setText(text: string): void {
    this.text = text;
  }

  setAttribute(name: string, value: string): void {
    this.attributes[name] = value;
  }

  appendChild(child: FakeElement): FakeElement {
    if (child.parentElement) {
      child.parentElement.children = child.parentElement.children.filter((c) => c !== child);
    }
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  getAttribute(name: string): string | undefined {
    return this.attributes[name];
  }
  removeAttribute(name: string): void {
    delete this.attributes[name];
  }


  addEventListener(_event: string, _handler: EventListener): void {}

  set innerHTML(html: string) {
    this.children = [];
    if (html.includes('pivi-working-icon')) {
      const icon = new FakeElement('pivi-working-icon');
      this.appendChild(icon);
    }
  }

  get innerHTML(): string {
    return '';
  }

  empty(): void {
    this.children = [];
    this.text = '';
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

  hasClass(className: string): boolean {
    return this.classes.has(className);
  }

  private appendNew(options?: { cls?: string; text?: string }): FakeElement {
    const child = new FakeElement(options?.cls);
    child.text = options?.text ?? '';
    child.parentElement = this;
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
  showThinkingIndicator: jest.Mock;
  scheduleToolOutputRender: jest.Mock;
} {
  const state = new ChatState();
  const parentEl = new FakeElement();
  state.currentContentEl = parentEl as unknown as HTMLElement;
  const showThinkingIndicator = jest.fn();
  const scheduleToolOutputRender = jest.fn();

  const renderer = new PendingToolRendering({
    state,
    showThinkingIndicator,
    scheduleToolOutputRender,
  });

  return {
    state,
    renderer,
    parentEl,
    showThinkingIndicator,
    scheduleToolOutputRender,
  };
}

describe('PendingToolRendering', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('aggregates consecutive aggregatable tool calls into one streaming tool step group', () => {
    const { state, renderer, parentEl } = createHarness();
    const msg = createMessage();

    renderer.handleRegularToolUse({ type: 'tool_use', id: 'a', name: 'Read', input: { path: 'a.md' } }, msg);
    renderer.handleRegularToolUse({ type: 'tool_use', id: 'b', name: 'Read', input: { path: 'b.md' } }, msg);

    const groups = parentEl.children.filter((child) => child.hasClass('pivi-tool-step-group'));
    expect(groups).toHaveLength(1);
    expect(mockRenderToolCall).not.toHaveBeenCalled();
    expect(state.streamingToolStepGroup).not.toBeNull();
    expect(state.toolCallElements.get('a')?.classList.contains('pivi-tool-call-in-step-group')).toBe(true);
    expect(state.toolCallElements.get('b')?.classList.contains('pivi-tool-call-in-step-group')).toBe(true);
  });

  it('wraps a single aggregatable tool call in one streaming tool step group', () => {
    const { state, renderer, parentEl } = createHarness();
    const msg = createMessage();

    renderer.handleRegularToolUse({ type: 'tool_use', id: 'solo', name: 'Read', input: { path: 'solo.md' } }, msg);

    const groups = parentEl.children.filter((child) => child.hasClass('pivi-tool-step-group'));
    expect(groups).toHaveLength(1);
    expect(state.streamingToolStepGroup?.groupEl).toBe(groups[0]);
    expect(mockRenderToolCall).not.toHaveBeenCalled();
  });

  it('starts a new streaming tool step group when assistant text begins a new segment', () => {
    const { state, renderer, parentEl } = createHarness();
    const msg = createMessage();

    renderer.handleRegularToolUse({ type: 'tool_use', id: 'a', name: 'Read', input: { path: 'a.md' } }, msg);
    closeStreamingToolStepGroup(state);
    renderer.handleRegularToolUse({ type: 'tool_use', id: 'b', name: 'Read', input: { path: 'b.md' } }, msg);

    const groups = parentEl.children.filter((child) => child.hasClass('pivi-tool-step-group'));
    expect(groups).toHaveLength(2);
    expect(state.streamingToolStepGroup?.groupEl).toBe(groups[1]);
  });

  it('clears the streaming tool step group when TextStreamPresenter opens a new text block', async () => {
    const { state, renderer, parentEl } = createHarness();
    const msg = createMessage();
    const textPresenter = new TextStreamPresenter({
      state,
      renderer: { renderContent: jest.fn().mockResolvedValue(undefined) } as never,
      getRenderWindow: () => globalThis as unknown as Window,
      getStreamingRenderOptions: () => undefined,
      shouldRenderDeferredMath: () => false,
      hideThinkingIndicator: jest.fn(),
      scrollToBottom: jest.fn(),
    });

    renderer.handleRegularToolUse({ type: 'tool_use', id: 'a', name: 'Read', input: { path: 'a.md' } }, msg);
    expect(state.streamingToolStepGroup).not.toBeNull();

    await textPresenter.appendText('Next segment.');
    expect(state.streamingToolStepGroup).toBeNull();
    expect(parentEl.children.some((child) => child.hasClass('pivi-text-block'))).toBe(true);

    renderer.handleRegularToolUse({ type: 'tool_use', id: 'b', name: 'Read', input: { path: 'b.md' } }, msg);
    const groups = parentEl.children.filter((child) => child.hasClass('pivi-tool-step-group'));
    expect(groups).toHaveLength(2);
  });


  it('clears the streaming tool step group when ThinkingStreamPresenter opens a thinking block', async () => {
    const { state, renderer, parentEl } = createHarness();
    const msg = createMessage();
    const thinkingPresenter = new ThinkingStreamPresenter({
      state,
      renderer: { renderContent: jest.fn().mockResolvedValue(undefined) } as never,
      getRenderWindow: () => globalThis as unknown as Window,
      getStreamingRenderOptions: () => undefined,
      hideThinkingIndicator: jest.fn(),
      scrollToBottom: jest.fn(),
    });

    renderer.handleRegularToolUse({ type: 'tool_use', id: 'a', name: 'Read', input: { path: 'a.md' } }, msg);
    expect(state.streamingToolStepGroup).not.toBeNull();

    await thinkingPresenter.appendThinking('Considering next step.');
    expect(state.streamingToolStepGroup).toBeNull();
    expect(parentEl.children.some((child) => child.hasClass('pivi-thinking-block'))).toBe(true);

    await thinkingPresenter.finalizeCurrentThinkingBlock(msg);
    renderer.handleRegularToolUse({ type: 'tool_use', id: 'b', name: 'Read', input: { path: 'b.md' } }, msg);

    const groups = parentEl.children.filter((child) => child.hasClass('pivi-tool-step-group'));
    expect(groups).toHaveLength(2);
    expect(state.streamingToolStepGroup?.groupEl).toBe(groups[1]);
  });

  it('starts a new streaming tool step group after a non-text activity boundary', () => {
    const { state, renderer, parentEl } = createHarness();
    const msg = createMessage();

    renderer.handleRegularToolUse({ type: 'tool_use', id: 'a', name: 'Read', input: { path: 'a.md' } }, msg);
    parentEl.appendChild(new FakeElement('pivi-subagent-activity-item'));
    closeStreamingToolStepGroup(state);
    renderer.handleRegularToolUse({ type: 'tool_use', id: 'b', name: 'Read', input: { path: 'b.md' } }, msg);

    const groups = parentEl.children.filter((child) => child.hasClass('pivi-tool-step-group'));
    expect(groups).toHaveLength(2);
    expect(state.toolCallElements.get('a')?.classList.contains('pivi-tool-call-in-step-group')).toBe(true);
    expect(state.toolCallElements.get('b')?.classList.contains('pivi-tool-call-in-step-group')).toBe(true);
  });


  it('clears the streaming tool step group when a non-aggregatable tool arrives', () => {
    const { state, renderer, parentEl } = createHarness();
    const msg = createMessage();

    renderer.handleRegularToolUse({ type: 'tool_use', id: 'read-1', name: 'Read', input: { path: 'a.md' } }, msg);
    renderer.handleRegularToolUse({
      type: 'tool_use',
      id: 'todo-1',
      name: TOOL_TODO_WRITE,
      input: { todos: [] },
    }, msg);

    const groups = parentEl.children.filter((child) => child.hasClass('pivi-tool-step-group'));
    expect(groups).toHaveLength(1);
    expect(state.streamingToolStepGroup).toBeNull();
    expect(mockRenderToolCall).toHaveBeenCalledTimes(1);
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
    expect(parentEl.children.filter((child) => child.hasClass('pivi-tool-step-group'))).toHaveLength(1);
    expect(mockRenderToolCall).not.toHaveBeenCalled();
  });
  it('renders write tools into write/edit state', () => {
    const { state, renderer } = createHarness();
    const msg = createMessage();

    renderer.handleRegularToolUse({
      type: 'tool_use',
      id: 'write-1',
      name: TOOL_WRITE,
      input: { file_path: 'notes/plan.md' },
    }, msg);
    renderer.renderPendingTool('write-1');

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

import {
  TOOL_ASK_USER_QUESTION,
  TOOL_BASH,
  TOOL_READ,
  TOOL_TASK,
  TOOL_TODO_WRITE,
  TOOL_WRITE,
} from '@pivi/pivi-agent-core/tools/toolNames';
import type { ChatMessage, ToolCallInfo } from '@pivi/pivi-agent-core/foundation';
import { renderAssistantContent } from '@/ui/chat/rendering/messageRendererAssistant';


import {
  TOOL_STEP_GROUP_CLASS,
  appendStepToStreamingGroup,
  createToolStepGroup,
  tryUpdateToolInStepGroup,
  renderStoredToolStepGroup,
} from '@/ui/chat/rendering/ToolStepGroupRenderer';
import { isAggregatablePlainToolCall } from '@/ui/chat/rendering/toolCallAggregation';


type FakeElementOptions = {
  cls?: string | string[];
  text?: string;
  attr?: Record<string, string>;
};

class TestHTMLElement {}
Object.defineProperty(window, 'HTMLElement', {
  configurable: true,
  value: TestHTMLElement,
});


class FakeElement extends TestHTMLElement {
  children: FakeElement[] = [];
  dataset: Record<string, string> = {};
  attributes: Record<string, string> = {};
  isConnected = true;
  ownerDocument = { activeElement: null, defaultView: window as unknown as Window };
  parentElement: FakeElement | null = null;
  text = '';
  private classes = new Set<string>();

  constructor(options: FakeElementOptions = {}) {
    super();
    this.applyOptions(options);
  }

  get className(): string {
    return [...this.classes].join(' ');
  }

  set className(value: string) {
    this.classes = new Set(value.split(/\s+/).filter(Boolean));
  }

  get cls(): string {
    return this.className;
  }

  set cls(value: string) {
    this.className = value;
  }

  get classList() {
    return {
      add: (...classes: string[]) => classes.forEach((cls) => this.addClass(cls)),
      remove: (...classes: string[]) => classes.forEach((cls) => this.removeClass(cls)),
      contains: (cls: string) => this.classes.has(cls),
    };
  }

  createDiv(options: FakeElementOptions = {}): FakeElement {
    return this.appendNew(options);
  }

  createSpan(options: FakeElementOptions = {}): FakeElement {
    return this.appendNew(options);
  }

  createEl(_tag: string, options: FakeElementOptions = {}): FakeElement {
    return this.appendNew(options);
  }

  createSvg(_tag: string, options: FakeElementOptions = {}): FakeElement {
    const child = this.appendNew(options);
    for (const [name, value] of Object.entries(options.attr ?? {})) {
      child.setAttribute(name, value);
    }
    return child;
  }

  appendChild(child: FakeElement): FakeElement {
    if (child.parentElement) {
      child.parentElement.children = child.parentElement.children.filter((c) => c !== child);
    }
    child.parentElement = this;
    this.children.push(child);
    return child;
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

  empty(): void {
    this.children.forEach((child) => {
      child.parentElement = null;
    });
    this.children = [];
    this.text = '';
  }

  setText(text: string): void {
    this.text = text;
  }

  setAttribute(name: string, value: string): void {
    this.attributes[name] = value;
  }

  getAttribute(name: string): string | undefined {
    return this.attributes[name];
  }

  removeAttribute(name: string): void {
    delete this.attributes[name];
  }
  private listeners = new Map<string, EventListener[]>();

  addEventListener(event: string, handler: EventListener): void {
    const list = this.listeners.get(event) ?? [];
    list.push(handler);
    this.listeners.set(event, list);
  }

  click(): void {
    for (const handler of this.listeners.get('click') ?? []) {
      handler({ preventDefault: () => {}, key: '' } as unknown as Event);
    }
  }

  set innerHTML(html: string) {
    this.children = [];
    if (html.includes('pivi-working-icon')) {
      const icon = new FakeElement();
      icon.addClass('pivi-working-icon');
      this.appendChild(icon);
    }
  }

  get innerHTML(): string {
    return '';
  }

  querySelector(selector: string): FakeElement | null {
    return this.find(selector);
  }

  find(selector: string): FakeElement | null {
    const classNames = selector
      .split(',')
      .map((part) => part.trim())
      .filter((part) => part.startsWith('.'))
      .map((part) => part.slice(1));
    if (classNames.length === 0) {
      return null;
    }
    return this.findDescendant((child) => classNames.some((cls) => child.hasClass(cls)));
  }

  get textContent(): string {
    if (this.text) {
      return this.text;
    }
    return this.children.map((child) => child.textContent).join('');
  }

  findByClass(cls: string): FakeElement | null {
    return this.findDescendant((child) => child.hasClass(cls));
  }

  findAllByClass(cls: string): FakeElement[] {
    const matches: FakeElement[] = [];
    this.collectByClass(cls, matches);
    return matches;
  }

  hasClass(cls: string): boolean {
    return this.classes.has(cls);
  }

  closest(selector: string): FakeElement | null {
    const className = selector.startsWith('.') ? selector.slice(1) : selector;
    let node: FakeElement | null = this;
    while (node) {
      if (node.hasClass(className)) {
        return node;
      }
      node = node.parentElement;
    }
    return null;
  }

  private appendNew(options: FakeElementOptions): FakeElement {
    return this.appendChild(new FakeElement(options));
  }

  private applyOptions(options: FakeElementOptions): void {
    const classes = Array.isArray(options.cls) ? options.cls : options.cls ? [options.cls] : [];
    classes.flatMap((cls) => cls.split(/\s+/)).filter(Boolean).forEach((cls) => this.addClass(cls));
    this.text = options.text ?? '';
    if (options.attr) {
      for (const [name, value] of Object.entries(options.attr)) {
        this.setAttribute(name, value);
      }
    }
  }

  private findDescendant(predicate: (element: FakeElement) => boolean): FakeElement | null {
    for (const child of this.children) {
      if (predicate(child)) return child;
      const nested = child.findDescendant(predicate);
      if (nested) return nested;
    }
    return null;
  }

  private collectByClass(cls: string, matches: FakeElement[]): void {
    if (this.hasClass(cls)) {
      matches.push(this);
    }
    for (const child of this.children) {
      child.collectByClass(cls, matches);
    }
  }
}

function createToolCall(overrides: Partial<ToolCallInfo> & Pick<ToolCallInfo, 'id' | 'name'>): ToolCallInfo {
  return {
    input: {},
    status: 'completed',
    ...overrides,
  };
}

function createAssistantHost(): { renderContent: jest.Mock } {
  return {
    renderContent: jest.fn().mockResolvedValue(undefined),
  };
}

describe('stored tool step group rendering', () => {
  it('collapses the step list with a chevron and aria-expanded false by default', () => {
    const parentEl = new FakeElement();
    const groupEl = renderStoredToolStepGroup(
      parentEl as unknown as HTMLElement,
      [
        createToolCall({ id: 'read-1', name: TOOL_READ, input: { path: 'a.md' } }),
        createToolCall({ id: 'read-2', name: TOOL_READ, input: { path: 'b.md' } }),
      ],
    ) as unknown as FakeElement;

    expect(groupEl.hasClass(TOOL_STEP_GROUP_CLASS)).toBe(true);
    const headerEl = groupEl.findByClass('pivi-tool-step-group-header');
    expect(headerEl?.findByClass('pivi-collapsible-chevron')).not.toBeNull();
    expect(headerEl?.getAttribute('aria-expanded')).toBe('false');
    expect(groupEl.findByClass('pivi-tool-step-group-steps')?.hasClass('pivi-hidden')).toBe(true);
  });

  it('nests consecutive plain tool calls inside one group instead of top-level cards', () => {
    const parentEl = new FakeElement();
    const contentEl = new FakeElement();
    parentEl.appendChild(contentEl);

    const msg: ChatMessage = {
      id: 'assistant-1',
      role: 'assistant',
      content: '',
      timestamp: 0,
      toolCalls: [
        createToolCall({ id: 'bash-1', name: TOOL_BASH, input: { command: 'ls' } }),
        createToolCall({ id: 'read-1', name: TOOL_READ, input: { path: 'notes.md' } }),
      ],
      contentBlocks: [
        { type: 'tool_use', toolId: 'bash-1' },
        { type: 'tool_use', toolId: 'read-1' },
      ],
    };

    renderAssistantContent(createAssistantHost(), msg, contentEl as unknown as HTMLElement);

    const groups = contentEl.findAllByClass(TOOL_STEP_GROUP_CLASS);
    expect(groups).toHaveLength(1);
    const topLevelToolCalls = contentEl.children.filter((child) => child.hasClass('pivi-tool-call'));
    expect(topLevelToolCalls).toHaveLength(0);
    const stepItems = groups[0]!.findAllByClass('pivi-tool-step-item');
    expect(stepItems).toHaveLength(2);
    expect(stepItems.map((el) => el.dataset.toolId)).toEqual(['bash-1', 'read-1']);
  });

  it('splits plain tool groups at assistant text blocks but keeps one group per segment', () => {
    const contentEl = new FakeElement();
    const msg: ChatMessage = {
      id: 'assistant-2',
      role: 'assistant',
      content: '',
      timestamp: 0,
      toolCalls: [
        createToolCall({ id: 'bash-1', name: TOOL_BASH, input: { command: 'ls' } }),
        createToolCall({ id: 'read-1', name: TOOL_READ, input: { path: 'notes.md' } }),
      ],
      contentBlocks: [
        { type: 'tool_use', toolId: 'bash-1' },
        { type: 'text', content: 'Here is what I found.' },
        { type: 'tool_use', toolId: 'read-1' },
      ],
    };

    renderAssistantContent(createAssistantHost(), msg, contentEl as unknown as HTMLElement);

    const groups = contentEl.findAllByClass(TOOL_STEP_GROUP_CLASS);
    expect(groups).toHaveLength(2);
    expect(contentEl.findAllByClass('pivi-tool-call').filter((el) => !el.hasClass('pivi-tool-call-in-step-group'))).toHaveLength(0);
    const stepItems = groups.flatMap((g) => g.findAllByClass('pivi-tool-step-item'));
    expect(stepItems).toHaveLength(2);
    expect(stepItems.map((el) => el.dataset.toolId)).toEqual(['bash-1', 'read-1']);
  });

  it('groups a single aggregatable tool into a step group', () => {
    const contentEl = new FakeElement();
    const msg: ChatMessage = {
      id: 'assistant-single',
      role: 'assistant',
      content: '',
      timestamp: 0,
      toolCalls: [createToolCall({ id: 'read-1', name: TOOL_READ, input: { path: 'only.md' } })],
      contentBlocks: [{ type: 'tool_use', toolId: 'read-1' }],
    };

    renderAssistantContent(createAssistantHost(), msg, contentEl as unknown as HTMLElement);

    expect(contentEl.findAllByClass(TOOL_STEP_GROUP_CLASS)).toHaveLength(1);
    expect(contentEl.findAllByClass('pivi-tool-call').filter((c) => !c.hasClass('pivi-tool-call-in-step-group'))).toHaveLength(0);
  });

  it('splits plain tool groups when a thinking block sits between aggregatable tools', () => {
    const contentEl = new FakeElement();
    const msg: ChatMessage = {
      id: 'assistant-thinking-between',
      role: 'assistant',
      content: '',
      timestamp: 0,
      toolCalls: [
        createToolCall({ id: 'bash-1', name: TOOL_BASH, input: { command: 'ls' } }),
        createToolCall({ id: 'read-1', name: TOOL_READ, input: { path: 'notes.md' } }),
      ],
      contentBlocks: [
        { type: 'tool_use', toolId: 'bash-1' },
        { type: 'thinking', content: 'Considering next step.' },
        { type: 'tool_use', toolId: 'read-1' },
      ],
    };

    renderAssistantContent(createAssistantHost(), msg, contentEl as unknown as HTMLElement);

    const groups = contentEl.findAllByClass(TOOL_STEP_GROUP_CLASS);
    expect(groups).toHaveLength(2);
    expect(groups[0]!.findAllByClass('pivi-tool-step-item').map((el) => el.dataset.toolId)).toEqual(['bash-1']);
    expect(groups[1]!.findAllByClass('pivi-tool-step-item').map((el) => el.dataset.toolId)).toEqual(['read-1']);
    expect(contentEl.findByClass('pivi-thinking-block')).not.toBeNull();
  });

  it('splits plain tool groups at compact boundaries', () => {
    const contentEl = new FakeElement();
    const msg: ChatMessage = {
      id: 'assistant-compact-between',
      role: 'assistant',
      content: '',
      timestamp: 0,
      toolCalls: [
        createToolCall({ id: 'read-a', name: TOOL_READ, input: { path: 'a.md' } }),
        createToolCall({ id: 'read-b', name: TOOL_READ, input: { path: 'b.md' } }),
      ],
      contentBlocks: [
        { type: 'tool_use', toolId: 'read-a' },
        { type: 'context_compacted' },
        { type: 'tool_use', toolId: 'read-b' },
      ],
    };

    renderAssistantContent(createAssistantHost(), msg, contentEl as unknown as HTMLElement);

    const groups = contentEl.findAllByClass(TOOL_STEP_GROUP_CLASS);
    expect(groups).toHaveLength(2);
    expect(groups[0]!.findAllByClass('pivi-tool-step-item').map((el) => el.dataset.toolId)).toEqual(['read-a']);
    expect(groups[1]!.findAllByClass('pivi-tool-step-item').map((el) => el.dataset.toolId)).toEqual(['read-b']);
    expect(contentEl.findByClass('pivi-compact-boundary')).not.toBeNull();
  });

  it('splits plain tool groups at subagent activity boundaries', () => {
    const contentEl = new FakeElement();
    const readA = createToolCall({ id: 'read-a', name: TOOL_READ, input: { path: 'a.md' } });
    const task = createToolCall({
      id: 'task-1',
      name: TOOL_TASK,
      input: { description: 'Explore', prompt: 'Go' },
      status: 'running',
    });
    const readB = createToolCall({ id: 'read-b', name: TOOL_READ, input: { path: 'b.md' } });
    const msg: ChatMessage = {
      id: 'assistant-subagent-between',
      role: 'assistant',
      content: '',
      timestamp: 0,
      toolCalls: [readA, task, readB],
      contentBlocks: [
        { type: 'tool_use', toolId: 'read-a' },
        { type: 'subagent', subagentId: 'task-1' },
        { type: 'tool_use', toolId: 'read-b' },
      ],
    };

    renderAssistantContent(createAssistantHost(), msg, contentEl as unknown as HTMLElement);

    const groups = contentEl.findAllByClass(TOOL_STEP_GROUP_CLASS);
    expect(groups).toHaveLength(2);
    expect(groups[0]!.findAllByClass('pivi-tool-step-item').map((el) => el.dataset.toolId)).toEqual(['read-a']);
    expect(groups[1]!.findAllByClass('pivi-tool-step-item').map((el) => el.dataset.toolId)).toEqual(['read-b']);
    expect(contentEl.findByClass('pivi-subagent-activity-item')).not.toBeNull();
  });


  it('keeps TodoWrite, AskUser, subagent, and write-edit tools out of plain tool groups', () => {
    const todo = createToolCall({ id: 'todo-1', name: TOOL_TODO_WRITE, input: { todos: [] } });
    const ask = createToolCall({ id: 'ask-1', name: TOOL_ASK_USER_QUESTION, input: { questions: [] } });
    const task = createToolCall({
      id: 'task-1',
      name: TOOL_TASK,
      input: { description: 'Explore', prompt: 'Go' },
      status: 'completed',
      result: 'ok',
    });
    const write = createToolCall({ id: 'write-1', name: TOOL_WRITE, input: { file_path: 'x.md', content: 'hi' } });

    expect(isAggregatablePlainToolCall(todo)).toBe(false);
    expect(isAggregatablePlainToolCall(ask)).toBe(false);
    expect(isAggregatablePlainToolCall(task)).toBe(false);
    expect(isAggregatablePlainToolCall(write)).toBe(false);

    const contentEl = new FakeElement();
    const msg: ChatMessage = {
      id: 'assistant-3',
      role: 'assistant',
      content: '',
      timestamp: 0,
      toolCalls: [todo, ask, task, write],
      contentBlocks: [
        { type: 'tool_use', toolId: 'todo-1' },
        { type: 'tool_use', toolId: 'ask-1' },
        { type: 'tool_use', toolId: 'task-1' },
        { type: 'tool_use', toolId: 'write-1' },
      ],
    };

    renderAssistantContent(createAssistantHost(), msg, contentEl as unknown as HTMLElement);

    expect(contentEl.findAllByClass(TOOL_STEP_GROUP_CLASS)).toHaveLength(0);
    expect(contentEl.findByClass('pivi-subagent-activity-item')).not.toBeNull();
    expect(contentEl.findByClass('pivi-write-edit-block')).not.toBeNull();
    expect(contentEl.findAllByClass('pivi-tool-call').length).toBeGreaterThanOrEqual(2);
  });

  it('closes the active plain tool group when a non-aggregatable tool appears and starts a new group after it', () => {
    const contentEl = new FakeElement();
    const readA = createToolCall({ id: 'read-a', name: TOOL_READ, input: { path: 'a.md' } });
    const todo = createToolCall({ id: 'todo-1', name: TOOL_TODO_WRITE, input: { todos: [] } });
    const write = createToolCall({ id: 'write-1', name: TOOL_WRITE, input: { file_path: 'out.md', content: 'hi' } });
    const readB = createToolCall({ id: 'read-b', name: TOOL_READ, input: { path: 'b.md' } });
    const msg: ChatMessage = {
      id: 'assistant-interleaved',
      role: 'assistant',
      content: '',
      timestamp: 0,
      toolCalls: [readA, todo, write, readB],
      contentBlocks: [
        { type: 'tool_use', toolId: 'read-a' },
        { type: 'tool_use', toolId: 'todo-1' },
        { type: 'tool_use', toolId: 'write-1' },
        { type: 'tool_use', toolId: 'read-b' },
      ],
    };

    renderAssistantContent(createAssistantHost(), msg, contentEl as unknown as HTMLElement);

    const groups = contentEl.findAllByClass(TOOL_STEP_GROUP_CLASS);
    expect(groups).toHaveLength(2);
    expect(groups[0]!.findAllByClass('pivi-tool-step-item').map((el) => el.dataset.toolId)).toEqual(['read-a']);
    expect(groups[1]!.findAllByClass('pivi-tool-step-item').map((el) => el.dataset.toolId)).toEqual(['read-b']);
    expect(contentEl.findByClass('pivi-write-edit-block')).not.toBeNull();
    const groupedToolIds = new Set(
      groups.flatMap((g) => g.findAllByClass('pivi-tool-step-item').map((el) => el.dataset.toolId)),
    );
    expect(groupedToolIds.has('todo-1')).toBe(false);
    expect(contentEl.findAllByClass('pivi-tool-call').filter((c) => !c.hasClass('pivi-tool-call-in-step-group')).length).toBeGreaterThanOrEqual(1);
  });
});

describe('streaming tool step group status accessibility', () => {
  it('keeps group status aria-label exposed without aria-hidden when running tools finish', () => {
    const parentEl = new FakeElement();
    const toolCallElements = new Map<string, HTMLElement>();
    const running = createToolCall({
      id: 'bash-1',
      name: TOOL_BASH,
      input: { command: 'ls' },
      status: 'running',
    });

    createToolStepGroup(parentEl as unknown as HTMLElement, [running], toolCallElements);

    const groupEl = parentEl.children.find((child) => child.hasClass(TOOL_STEP_GROUP_CLASS))!;
    const statusEl = groupEl.findByClass('pivi-tool-step-group-status')!;

    expect(statusEl.getAttribute('aria-label')).toBe('Status: running');
    expect(statusEl.getAttribute('aria-hidden')).toBeUndefined();
    const workingIconWrap = statusEl.findByClass('pivi-tool-step-group-working-icon');
    expect(workingIconWrap?.getAttribute('aria-hidden')).toBe('true');

    tryUpdateToolInStepGroup('bash-1', { ...running, status: 'completed' }, toolCallElements);
    expect(statusEl.getAttribute('aria-label')).toBe('Status: completed');
    expect(statusEl.getAttribute('aria-hidden')).toBeUndefined();
    expect(statusEl.findByClass('pivi-tool-step-group-working-icon')).toBeNull();

    tryUpdateToolInStepGroup('bash-1', { ...running, status: 'error' }, toolCallElements);
    expect(statusEl.getAttribute('aria-label')).toBe('Status: error');
    expect(statusEl.getAttribute('aria-hidden')).toBeUndefined();
  });

  it('keeps two-step group header aria-label after append and collapsible toggle', () => {
    const parentEl = new FakeElement();
    const read1 = createToolCall({ id: 'read-1', name: TOOL_READ, input: { path: 'first.md' } });
    const read2 = createToolCall({ id: 'read-2', name: TOOL_READ, input: { path: 'second.md' } });
    const state = createToolStepGroup(parentEl as unknown as HTMLElement, [read1]);
    appendStepToStreamingGroup(state, read2);

    const headerEl = state.headerEl as unknown as FakeElement;
    expect(headerEl.getAttribute('aria-label')).toMatch(/2 steps, latest: Read file/);

    headerEl.click();
    expect(headerEl.getAttribute('aria-label')).toMatch(/2 steps, latest:/);
    expect(headerEl.getAttribute('aria-label')).not.toMatch(/^1 step[, -]/);

    headerEl.click();
    expect(headerEl.getAttribute('aria-label')).toMatch(/2 steps, latest:/);
    expect((state.countEl as unknown as FakeElement).text).toBe('2 steps');
  });
});

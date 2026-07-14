import type { SubagentInfo, ToolCallInfo } from '@pivi/pivi-agent-core/foundation';
import {
  createAsyncSubagentBlock,
  finalizeAsyncSubagent,
  renderStoredAsyncSubagent,
} from '@/ui/chat/rendering/AsyncSubagentRenderer';
import {
  addSubagentToolCall,
  createSubagentBlock,
  mountStoredSubagent,
  renderStoredSubagent,
  updateStoredSubagent,
} from '@/ui/chat/rendering/SubagentRenderer';
import { applySubagentHeaderIcon } from '@/ui/chat/rendering/subagentRendererShared';

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
  scrollHeight = 0;
  scrollTop = 0;
  text = '';
  private classes = new Set<string>();

  constructor(options: FakeElementOptions = {}) {
    super();
    this.applyOptions(options);
  }

  get childElementCount(): number {
    return this.children.length;
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
      add: (...classes: string[]) => classes.forEach(cls => this.addClass(cls)),
      remove: (...classes: string[]) => classes.forEach(cls => this.removeClass(cls)),
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

  appendChild(child: FakeElement): FakeElement {
    if (child.parentElement) {
      child.parentElement.children = child.parentElement.children.filter(candidate => candidate !== child);
    }
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  toggleClass(cls: string, active: boolean): void {
    if (active) {
      this.addClass(cls);
    } else {
      this.removeClass(cls);
    }
  }

  set innerHTML(html: string) {
    this.children = [];
    if (html.includes('pivi-working-icon')) {
      const svg = new FakeElement();
      svg.addClass('pivi-working-icon');
      this.appendChild(svg);
    }
  }

  get innerHTML(): string {
    return this.findByClass('pivi-working-icon') ? '<span class="pivi-working-icon"></span>' : '';
  }

  addClass(cls: string): void {
    this.classes.add(cls);
  }

  removeClass(cls: string): void {
    this.classes.delete(cls);
  }

  contains(child: FakeElement): boolean {
    return child === this || this.children.some(candidate => candidate.contains(child));
  }

  empty(): void {
    this.children.forEach(child => {
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

  remove(): void {
    this.isConnected = false;
    if (this.parentElement) {
      this.parentElement.children = this.parentElement.children.filter(child => child !== this);
      this.parentElement = null;
    }
  }

  querySelector(selector: string): FakeElement | null {
    const classNames = selector
      .split(',')
      .map(part => part.trim())
      .filter(part => part.startsWith('.'))
      .map(part => part.slice(1));
    return this.find(child => classNames.some(cls => child.hasClass(cls)));
  }

  findByClass(cls: string): FakeElement | null {
    return this.find(child => child.hasClass(cls));
  }

  findAllByClass(cls: string): FakeElement[] {
    const matches: FakeElement[] = [];
    if (this.hasClass(cls)) matches.push(this);
    for (const child of this.children) {
      matches.push(...child.findAllByClass(cls));
    }
    return matches;
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

  hasClass(cls: string): boolean {
    return this.classes.has(cls);
  }

  get textContent(): string {
    if (this.text) {
      return this.text;
    }
    return this.children.map((child) => child.textContent).join('');
  }


  private appendNew(options: FakeElementOptions): FakeElement {
    return this.appendChild(new FakeElement(options));
  }

  private applyOptions(options: FakeElementOptions): void {
    const classes = Array.isArray(options.cls) ? options.cls : options.cls ? [options.cls] : [];
    classes.flatMap(cls => cls.split(/\s+/)).filter(Boolean).forEach(cls => this.addClass(cls));
    this.text = options.text ?? '';
    if (options.attr) {
      for (const [name, value] of Object.entries(options.attr)) {
        this.setAttribute(name, value);
      }
    }
  }

  private find(predicate: (element: FakeElement) => boolean): FakeElement | null {
    for (const child of this.children) {
      if (predicate(child)) return child;
      const nested = child.find(predicate);
      if (nested) return nested;
    }
    return null;
  }
}

function createRunningAsyncSubagent(): SubagentInfo {
  return {
    id: 'spawn-1',
    writerName: 'Austen',
    description: 'Review architecture',
    prompt: 'Review architecture files',
    mode: 'async',
    status: 'running',
    asyncStatus: 'running',
    toolCalls: [],
    isExpanded: false,
  };
}

function createPlainToolCall(id: string, path: string): ToolCallInfo {
  return {
    id,
    name: 'Read',
    input: { path },
    status: 'completed',
    isExpanded: false,
  };
}

function createToolCall(
  id: string,
  name: string,
  input: Record<string, unknown> = {},
  overrides: Partial<ToolCallInfo> = {},
): ToolCallInfo {
  return {
    id,
    name,
    input,
    status: 'completed',
    isExpanded: false,
    ...overrides,
  };
}

function expectDirectToolRunKinds(
  toolsContainer: FakeElement,
  expectedKinds: Array<'group' | 'single'>,
): void {
  expect(toolsContainer.children.map((child) => {
    if (child.hasClass('pivi-tool-step-group')) return 'group';
    if (child.hasClass('pivi-tool-call')) return 'single';
    return 'unknown';
  })).toEqual(expectedKinds);
}

function expectSubagentHeaderShell(
  wrapperEl: FakeElement,
  expected: { agentName: string; taskDescription: string; statusText: string },
): void {
  const headerEl = wrapperEl.findByClass('pivi-subagent-header');
  expect(headerEl?.children.slice(0, 4).map(child => child.className)).toEqual([
    expect.stringContaining('pivi-subagent-icon'),
    expect.stringContaining('pivi-subagent-label'),
    expect.stringContaining('pivi-subagent-step-summary'),
    expect.stringContaining('pivi-subagent-status'),
  ]);

  const labelEl = wrapperEl.findByClass('pivi-subagent-label');
  expect(labelEl?.text).toBe(expected.agentName);
  expect(labelEl?.text).not.toContain('[');
  expect(labelEl?.text).not.toContain(expected.taskDescription);

  expect(wrapperEl.findByClass('pivi-subagent-step-summary')?.text).toBe(expected.taskDescription);

  const statusEl = wrapperEl.findByClass('pivi-subagent-status');
  expect(statusEl?.text).toBe(expected.statusText);
  expect(statusEl?.getAttribute('aria-label')).toBe(`Status: ${expected.statusText}`);

  const iconEl = wrapperEl.findByClass('pivi-subagent-icon');
  if (expected.statusText === 'Working') {
    expect(iconEl?.hasClass('pivi-working-icon')).toBe(true);
    expect(iconEl?.hasClass('pivi-subagent-running-icon')).toBe(true);
    expect(iconEl?.hasClass('pivi-subagent-completed-icon')).toBe(false);
    expect(iconEl?.findByClass('pivi-subagent-indicator-dot')).toBeNull();
  } else if (expected.statusText === 'Completed') {
    expect(iconEl?.hasClass('pivi-subagent-completed-icon')).toBe(true);
    expect(iconEl?.hasClass('pivi-subagent-running-icon')).toBe(false);
    expect(iconEl?.findByClass('pivi-subagent-indicator-dot')).toBeNull();
    expect(iconEl?.hasClass('pivi-working-icon')).toBe(false);
  } else {
    expect(iconEl?.findByClass('pivi-subagent-indicator-dot')).not.toBeNull();
    expect(iconEl?.hasClass('pivi-working-icon')).toBe(false);
    expect(iconEl?.hasClass('pivi-subagent-running-icon')).toBe(false);
    expect(iconEl?.hasClass('pivi-subagent-completed-icon')).toBe(false);
  }
}


describe('subagent activity rendering', () => {
  it('renders stored async subagents as collapsed activity items', () => {
    const parentEl = new FakeElement();
    const wrapperEl = renderStoredAsyncSubagent(
      parentEl as unknown as HTMLElement,
      createRunningAsyncSubagent(),
    ) as unknown as FakeElement;

    expect(wrapperEl.hasClass('pivi-subagent-activity-item')).toBe(true);
    expect(wrapperEl.hasClass('expanded')).toBe(false);
    expect(wrapperEl.findByClass('pivi-subagent-content')?.hasClass('pivi-hidden')).toBe(true);
    expectSubagentHeaderShell(wrapperEl, {
      agentName: 'Austen',
      taskDescription: 'Review architecture',
      statusText: 'Working',
    });
  });

  it('renders async subagent headers with agent name, task summary, and an animated icon while running', () => {
    const parentEl = new FakeElement();
    const wrapperEl = renderStoredAsyncSubagent(
      parentEl as unknown as HTMLElement,
      createRunningAsyncSubagent(),
    ) as unknown as FakeElement;

    expectSubagentHeaderShell(wrapperEl, {
      agentName: 'Austen',
      taskDescription: 'Review architecture',
      statusText: 'Working',
    });
    expect(wrapperEl.findByClass('pivi-subagent-header')?.getAttribute('aria-label')).toContain('Working');
  });

  it('shows Working in header and status while async subagents are pending', () => {
    const parentEl = new FakeElement();
    const wrapperEl = renderStoredAsyncSubagent(
      parentEl as unknown as HTMLElement,
      {
        ...createRunningAsyncSubagent(),
        asyncStatus: 'pending',
        status: 'running',
      },
    ) as unknown as FakeElement;

    expectSubagentHeaderShell(wrapperEl, {
      agentName: 'Austen',
      taskDescription: 'Review architecture',
      statusText: 'Working',
    });
    expect(wrapperEl.findByClass('pivi-subagent-header')?.getAttribute('aria-label')).toContain('Working');
  });

  it('uses Working in the initial async subagent header aria-label while pending, not Initializing', () => {
    const parentEl = new FakeElement();
    const state = createAsyncSubagentBlock(
      parentEl as unknown as HTMLElement,
      'task-tool-1',
      { description: 'Review architecture', prompt: 'Go' },
      { writerName: 'Austen' },
    );
    const wrapperEl = state.wrapperEl as unknown as FakeElement;
    expectSubagentHeaderShell(wrapperEl, {
      agentName: 'Austen',
      taskDescription: 'Review architecture',
      statusText: 'Working',
    });
    const label = (state.headerEl as unknown as FakeElement).getAttribute('aria-label') ?? '';
    expect(label).toContain('Working');
    expect(label).not.toContain('Initializing');

    const contentEl = state.contentEl as unknown as FakeElement;
    expect(contentEl.hasClass('pivi-hidden')).toBe(true);
    expect(contentEl.findByClass('pivi-subagent-tools')).toBeNull();
  });

  it('uses Working in the sync subagent header aria-label while running', () => {
    const parentEl = new FakeElement();
    const state = createSubagentBlock(
      parentEl as unknown as HTMLElement,
      'task-sync-1',
      { description: 'Scan repo', prompt: 'Scan the repository' },
      { writerName: 'Kafka' },
    );
    expectSubagentHeaderShell(state.wrapperEl as unknown as FakeElement, {
      agentName: 'Kafka',
      taskDescription: 'Scan repo',
      statusText: 'Working',
    });
    expect((state.headerEl as unknown as FakeElement).getAttribute('aria-label')).toContain('Working');
  });

  it('renders sync subagent headers with agent name, task summary, and an animated icon while running', () => {
    const parentEl = new FakeElement();
    const wrapperEl = renderStoredSubagent(
      parentEl as unknown as HTMLElement,
      {
        id: 'task-running',
        writerName: 'Kafka',
        description: 'Scan repo',
        prompt: 'Scan the repository',
        status: 'running',
        toolCalls: [],
        isExpanded: false,
      },
    ) as unknown as FakeElement;

    expectSubagentHeaderShell(wrapperEl, {
      agentName: 'Kafka',
      taskDescription: 'Scan repo',
      statusText: 'Working',
    });
    expect(wrapperEl.findByClass('pivi-subagent-header')?.getAttribute('aria-label')).toContain('Working');
  });

  it('keeps the profile icon without running animation when a sync subagent finishes', () => {
    const parentEl = new FakeElement();
    const wrapperEl = renderStoredSubagent(
      parentEl as unknown as HTMLElement,
      {
        id: 'task-done',
        writerName: 'Borges',
        description: 'Read long file',
        prompt: 'Read the file and summarize it',
        status: 'completed',
        result: 'Done',
        toolCalls: [],
        isExpanded: false,
      },
    ) as unknown as FakeElement;

    expectSubagentHeaderShell(wrapperEl, {
      agentName: 'Borges',
      taskDescription: 'Read long file',
      statusText: 'Completed',
    });
    const iconEl = wrapperEl.findByClass('pivi-subagent-icon');
    expect(iconEl?.hasClass('pivi-subagent-profile-icon--compass')).toBe(true);
    expect(iconEl?.hasClass('pivi-subagent-running-icon--compass')).toBe(false);
    expect(wrapperEl.findByClass('pivi-subagent-status')?.hasClass('status-completed')).toBe(true);
  });

  it('keeps the same named profile icon across running and completed states', () => {
    const iconEl = new FakeElement({ cls: 'pivi-subagent-icon' });
    const info = {
      ...createRunningAsyncSubagent(),
      writerName: 'Woolf',
    };

    applySubagentHeaderIcon(iconEl as unknown as HTMLElement, info);
    expect(iconEl.hasClass('pivi-subagent-profile-icon--waves')).toBe(true);
    expect(iconEl.hasClass('pivi-subagent-running-icon--waves')).toBe(true);

    applySubagentHeaderIcon(iconEl as unknown as HTMLElement, {
      ...info,
      asyncStatus: 'completed',
      status: 'completed',
    });
    expect(iconEl.hasClass('pivi-subagent-profile-icon--waves')).toBe(true);
    expect(iconEl.hasClass('pivi-subagent-completed-icon')).toBe(true);
    expect(iconEl.hasClass('pivi-subagent-running-icon')).toBe(false);
    expect(iconEl.hasClass('pivi-subagent-running-icon--waves')).toBe(false);
  });

  it('keeps the async subagent profile icon when a live task completes', () => {
    const parentEl = new FakeElement();
    const state = createAsyncSubagentBlock(
      parentEl as unknown as HTMLElement,
      'task-live-complete',
      { description: 'Review architecture', prompt: 'Go' },
      { writerName: 'Austen' },
    );

    finalizeAsyncSubagent(state, 'Done', false);

    const iconEl = (state.wrapperEl as unknown as FakeElement).findByClass('pivi-subagent-icon');
    expect(iconEl?.hasClass('pivi-subagent-profile-icon--rocking-chair')).toBe(true);
    expect(iconEl?.hasClass('pivi-subagent-completed-icon')).toBe(true);
    expect(iconEl?.hasClass('pivi-subagent-running-icon')).toBe(false);
    expect(iconEl?.hasClass('pivi-working-icon')).toBe(false);
  });

  it('uses the waves running icon for Woolf subagents', () => {
    const parentEl = new FakeElement();
    const wrapperEl = renderStoredAsyncSubagent(
      parentEl as unknown as HTMLElement,
      {
        ...createRunningAsyncSubagent(),
        writerName: 'Woolf',
      },
    ) as unknown as FakeElement;

    const iconEl = wrapperEl.findByClass('pivi-subagent-icon');
    expect(iconEl?.hasClass('pivi-subagent-running-icon')).toBe(true);
    expect(iconEl?.hasClass('pivi-subagent-running-icon--waves')).toBe(true);
  });

  it('uses the flame running icon for Baldwin subagents even with a suffix', () => {
    const parentEl = new FakeElement();
    const wrapperEl = renderStoredAsyncSubagent(
      parentEl as unknown as HTMLElement,
      {
        ...createRunningAsyncSubagent(),
        writerName: 'Baldwin 2',
      },
    ) as unknown as FakeElement;

    const iconEl = wrapperEl.findByClass('pivi-subagent-icon');
    expect(iconEl?.hasClass('pivi-subagent-running-icon')).toBe(true);
    expect(iconEl?.hasClass('pivi-subagent-running-icon--flame')).toBe(true);
  });

  it('uses the satellite-dish running icon for Le Guin subagents with a suffix', () => {
    const parentEl = new FakeElement();
    const wrapperEl = renderStoredAsyncSubagent(
      parentEl as unknown as HTMLElement,
      {
        ...createRunningAsyncSubagent(),
        writerName: 'Le Guin 2',
      },
    ) as unknown as FakeElement;

    const iconEl = wrapperEl.findByClass('pivi-subagent-icon');
    expect(iconEl?.hasClass('pivi-subagent-running-icon')).toBe(true);
    expect(iconEl?.hasClass('pivi-subagent-running-icon--satellite-dish')).toBe(true);
  });

  it.each([
    ['Calvino', 'tree'],
    ['Rand', 'scale'],
    ['Mishima', 'flower-2'],
    ['Pamuk', 'snowflake'],
  ])('uses the %s profile icon definition', (writerName, iconName) => {
    const parentEl = new FakeElement();
    const wrapperEl = renderStoredAsyncSubagent(
      parentEl as unknown as HTMLElement,
      {
        ...createRunningAsyncSubagent(),
        writerName,
      },
    ) as unknown as FakeElement;

    const iconEl = wrapperEl.findByClass('pivi-subagent-icon');
    expect(iconEl?.hasClass('pivi-subagent-running-icon')).toBe(true);
    expect(iconEl?.hasClass(`pivi-subagent-running-icon--${iconName}`)).toBe(true);
  });

  it('clears animated subagent icon classes when falling back to the status dot', () => {
    const iconEl = new FakeElement({ cls: 'pivi-subagent-icon' });
    applySubagentHeaderIcon(iconEl as unknown as HTMLElement, {
      ...createRunningAsyncSubagent(),
      writerName: 'Woolf',
    });

    expect(iconEl.hasClass('pivi-working-icon')).toBe(true);
    expect(iconEl.hasClass('pivi-subagent-running-icon')).toBe(true);
    expect(iconEl.hasClass('pivi-subagent-running-icon--waves')).toBe(true);

    applySubagentHeaderIcon(iconEl as unknown as HTMLElement, {
      ...createRunningAsyncSubagent(),
      asyncStatus: 'error',
      status: 'error',
      writerName: 'Woolf',
    });

    expect(iconEl.hasClass('pivi-working-icon')).toBe(false);
    expect(iconEl.hasClass('pivi-subagent-running-icon')).toBe(false);
    expect(iconEl.hasClass('pivi-subagent-running-icon--waves')).toBe(false);
    expect(iconEl.hasClass('pivi-subagent-completed-icon')).toBe(false);
    expect(iconEl.findByClass('pivi-subagent-indicator-dot')).not.toBeNull();
  });

  it('renders a collapsible chevron on the subagent header when collapsed', () => {
    const parentEl = new FakeElement();
    const wrapperEl = renderStoredAsyncSubagent(
      parentEl as unknown as HTMLElement,
      createRunningAsyncSubagent(),
    ) as unknown as FakeElement;

    const headerEl = wrapperEl.findByClass('pivi-subagent-header');
    expect(headerEl?.findByClass('pivi-collapsible-chevron')).not.toBeNull();
    expect(headerEl?.getAttribute('aria-expanded')).toBe('false');
    expect(wrapperEl.findByClass('pivi-subagent-content')?.hasClass('pivi-hidden')).toBe(true);
  });

  it('renders stored sync subagents with the same compact activity shell', () => {
    const parentEl = new FakeElement();
    const wrapperEl = renderStoredSubagent(
      parentEl as unknown as HTMLElement,
      {
        id: 'task-1',
        writerName: 'Borges',
        description: 'Read long file',
        prompt: 'Read the file and summarize it',
        status: 'completed',
        result: 'Done',
        toolCalls: [],
        isExpanded: false,
      },
    ) as unknown as FakeElement;

    expect(wrapperEl.hasClass('pivi-subagent-activity-item')).toBe(true);
    expect(wrapperEl.findByClass('pivi-subagent-content')?.hasClass('pivi-hidden')).toBe(true);
    expect(wrapperEl.findByClass('pivi-subagent-status')?.hasClass('status-completed')).toBe(true);
  });

  it('does not treat async progress DOM as the header working state', () => {
    const parentEl = new FakeElement();
    const state = createAsyncSubagentBlock(
      parentEl as unknown as HTMLElement,
      'task-async-progress',
      { description: 'Review architecture', prompt: 'Go' },
      { writerName: 'Austen' },
    );
    const wrapperEl = state.wrapperEl as unknown as FakeElement;

    expect(wrapperEl.findByClass('pivi-subagent-progress')).not.toBeNull();
    expectSubagentHeaderShell(wrapperEl, {
      agentName: 'Austen',
      taskDescription: 'Review architecture',
      statusText: 'Working',
    });
  });

  it('aggregates sync subagent tool_use steps into one tool step group', () => {
    const parentEl = new FakeElement();
    const state = createSubagentBlock(
      parentEl as unknown as HTMLElement,
      'task-sync-tools',
      { description: 'Scan repo', prompt: 'Scan the repository' },
    );
    const toolsContainer = state.toolsContainerEl as unknown as FakeElement;

    addSubagentToolCall(state, createPlainToolCall('read-a', 'a.md'));
    addSubagentToolCall(state, createPlainToolCall('read-b', 'b.md'));

    const groups = toolsContainer.findAllByClass('pivi-tool-step-group');
    expect(groups).toHaveLength(1);
    const [group] = groups;
    expect(group).toBeDefined();
    if (!group) throw new Error('Expected the aggregated tool step group');
    expect(group.findByClass('pivi-tool-step-group-count')?.text).toBe('2 steps');
    expect(group.findByClass('pivi-tool-step-group-summary')?.text).toBe('Read');
    expect(group.findByClass('pivi-tool-step-group-header')?.getAttribute('aria-label'))
      .toContain('2 steps, Read');
    expect(group.findByClass('pivi-tool-step-group-header')?.getAttribute('aria-label'))
      .not.toContain('b.md');
    expect(toolsContainer.findAllByClass('pivi-subagent-tool-item')).toHaveLength(0);
  });

  it('filters hidden sync calls and separates contiguous groups around standalone rows', () => {
    const parentEl = new FakeElement();
    const state = createSubagentBlock(
      parentEl as unknown as HTMLElement,
      'task-sync-mixed-tools',
      { description: 'Inspect mixed tools', prompt: 'Inspect tool presentation' },
    );
    const toolsContainer = state.toolsContainerEl as unknown as FakeElement;
    const nestedSubagent = {
      ...createRunningAsyncSubagent(),
      id: 'nested-agent',
    };

    [
      createPlainToolCall('read-a', 'a.md'),
      createToolCall('task-output', 'TaskOutput', { task_id: 'nested-agent' }),
      createToolCall('custom-output', 'custom_tool_call_output', { output: 'provider event' }),
      createToolCall('empty-stdin', 'write_stdin', { session_id: 1, chars: '' }),
      createPlainToolCall('read-b', 'b.md'),
      createToolCall('todo', 'TodoWrite', {
        todos: [{ content: 'Inspect tests', status: 'in_progress' }],
      }),
      createToolCall('ask', 'AskUserQuestion', {
        questions: [{ question: 'Continue?', options: [] }],
      }),
      createToolCall('agent', 'Agent', {
        description: 'Review boundaries',
        prompt: 'Review the boundary rules',
      }),
      createToolCall('payload', 'Read', { path: 'nested.md' }, { subagent: nestedSubagent }),
      createPlainToolCall('read-c', 'c.md'),
      createPlainToolCall('read-d', 'd.md'),
    ].forEach((toolCall) => addSubagentToolCall(state, toolCall));

    expectDirectToolRunKinds(toolsContainer, [
      'group',
      'single',
      'single',
      'single',
      'single',
      'group',
    ]);
    expect(toolsContainer.findAllByClass('pivi-tool-step-group')).toHaveLength(2);
    expect(toolsContainer.findAllByClass('pivi-tool-step-group-count').map((element) => element.text))
      .toEqual(['2 steps', '2 steps']);
    expect(toolsContainer.findAllByClass('pivi-tool-call')).toHaveLength(8);
    expect(toolsContainer.textContent).not.toContain('TaskOutput');
    expect(toolsContainer.textContent).not.toContain('custom_tool_call_output');
    expect(toolsContainer.textContent).not.toContain('write_stdin');
  });

  it('mounts a previously hidden write_stdin call when a later update adds chars', () => {
    const parentEl = new FakeElement();
    const state = createSubagentBlock(
      parentEl as unknown as HTMLElement,
      'task-sync-stdin-update',
      { description: 'Drive terminal input', prompt: 'Send input when available' },
    );
    const toolsContainer = state.toolsContainerEl as unknown as FakeElement;

    addSubagentToolCall(
      state,
      createToolCall('stdin', 'write_stdin', { session_id: 1, chars: '' }, { status: 'running' }),
    );
    expect(toolsContainer.findAllByClass('pivi-tool-call')).toHaveLength(0);

    addSubagentToolCall(
      state,
      createToolCall('stdin', 'write_stdin', { session_id: 1, chars: 'continue\n' }),
    );

    expectDirectToolRunKinds(toolsContainer, ['group']);
    expect(toolsContainer.findAllByClass('pivi-tool-call')).toHaveLength(1);
    expect(toolsContainer.findByClass('pivi-tool-step-group-count')?.text).toContain('1');
  });

  it('renders stored async subagent tool calls as one N steps group after expanding', () => {
    const parentEl = new FakeElement();
    const wrapperEl = renderStoredAsyncSubagent(
      parentEl as unknown as HTMLElement,
      {
        ...createRunningAsyncSubagent(),
        status: 'completed',
        asyncStatus: 'completed',
        result: 'Done',
        toolCalls: [
          createPlainToolCall('read-a', 'a.md'),
          createPlainToolCall('read-b', 'b.md'),
        ],
      },
    ) as unknown as FakeElement;

    const headerEl = wrapperEl.findByClass('pivi-subagent-header') as FakeElement;
    expect(wrapperEl.findByClass('pivi-subagent-tools')).toBeNull();

    headerEl.click();

    const toolsContainer = wrapperEl.findByClass('pivi-subagent-tools') as FakeElement;
    expect(toolsContainer).not.toBeNull();
    const groups = toolsContainer.findAllByClass('pivi-tool-step-group');
    expect(groups).toHaveLength(1);
    const [group] = groups;
    expect(group).toBeDefined();
    if (!group) throw new Error('Expected the expanded tool step group');
    expect(group.findByClass('pivi-tool-step-group-count')?.text).toBe('2 steps');
    expect(toolsContainer.findAllByClass('pivi-subagent-tool-item')).toHaveLength(0);
  });

  it('filters and groups mixed stored async subagent calls after expanding', () => {
    const parentEl = new FakeElement();
    const wrapperEl = renderStoredAsyncSubagent(
      parentEl as unknown as HTMLElement,
      {
        ...createRunningAsyncSubagent(),
        status: 'completed',
        asyncStatus: 'completed',
        result: 'Done',
        toolCalls: [
          createPlainToolCall('read-a', 'a.md'),
          createToolCall('task-output', 'TaskOutput', { task_id: 'nested-agent' }),
          createToolCall('custom-output', 'custom_tool_call_output', { output: 'provider event' }),
          createToolCall('empty-stdin', 'write_stdin', { session_id: 1, chars: '' }),
          createPlainToolCall('read-b', 'b.md'),
          createToolCall('todo', 'TodoWrite', {
            todos: [{ content: 'Inspect tests', status: 'completed' }],
          }),
          createToolCall('ask', 'AskUserQuestion', {
            questions: [{ question: 'Continue?', options: [] }],
          }),
          createPlainToolCall('read-c', 'c.md'),
          createPlainToolCall('read-d', 'd.md'),
        ],
      },
    ) as unknown as FakeElement;

    const headerEl = wrapperEl.findByClass('pivi-subagent-header') as FakeElement;
    headerEl.click();

    const toolsContainer = wrapperEl.findByClass('pivi-subagent-tools') as FakeElement;
    expectDirectToolRunKinds(toolsContainer, ['group', 'single', 'single', 'group']);
    expect(toolsContainer.findAllByClass('pivi-tool-step-group-count').map((element) => element.text))
      .toEqual(['2 steps', '2 steps']);
    expect(toolsContainer.findAllByClass('pivi-tool-call')).toHaveLength(6);
    expect(toolsContainer.textContent).not.toContain('TaskOutput');
    expect(toolsContainer.textContent).not.toContain('custom_tool_call_output');
    expect(toolsContainer.textContent).not.toContain('write_stdin');
  });

  it('renders stored sync subagent tool calls as one N steps group', () => {
    const parentEl = new FakeElement();
    const wrapperEl = renderStoredSubagent(
      parentEl as unknown as HTMLElement,
      {
        id: 'task-stored-tools',
        writerName: 'Kafka',
        description: 'Scan repo',
        prompt: 'Scan the repository',
        status: 'completed',
        result: 'Done',
        toolCalls: [
          createPlainToolCall('read-a', 'a.md'),
          createPlainToolCall('read-b', 'b.md'),
        ],
        isExpanded: true,
      },
    ) as unknown as FakeElement;

    const toolsContainer = wrapperEl.findByClass('pivi-subagent-tools') as FakeElement;
    const groups = toolsContainer.findAllByClass('pivi-tool-step-group');
    expect(groups).toHaveLength(1);
    const [group] = groups;
    expect(group).toBeDefined();
    if (!group) throw new Error('Expected the stored tool step group');
    expect(group.findByClass('pivi-tool-step-group-count')?.text).toBe('2 steps');
    expect(toolsContainer.findAllByClass('pivi-subagent-tool-item')).toHaveLength(0);
  });
});
describe('mounted stored subagent updates', () => {
  it('updates a mounted stored subagent without rebuilding or collapsing it', () => {
    const parent = new FakeElement();
    const toolCalls: ToolCallInfo[] = [];
    const initial: SubagentInfo = {
      id: 'spawn-stable',
      description: 'Scan notes',
      prompt: 'Scan the assigned notes',
      status: 'running',
      isExpanded: false,
      toolCalls,
    };
    const state = mountStoredSubagent(
      parent as unknown as HTMLElement,
      initial,
    );
    const wrapper = state.wrapperEl;
    state.headerEl.click();

    updateStoredSubagent(state, {
      ...initial,
      result: 'streaming text',
      isExpanded: false,
      toolCalls,
    });

    expect(state.wrapperEl).toBe(wrapper);
    expect(state.info.isExpanded).toBe(true);
    expect(state.headerEl.getAttribute('aria-expanded')).toBe('true');
    expect(parent.children).toHaveLength(1);
  });
});

import type { ChatMessage, SubagentInfo } from '@pivi/pivi-agent-core/foundation';

import { refreshMessageActions } from '@/ui/chat/rendering/messageRendererActions';
import { renderStoredAsyncSubagent } from '@/ui/chat/rendering/AsyncSubagentRenderer';
import { renderStoredSubagent } from '@/ui/chat/rendering/SubagentRenderer';

type FakeElementOptions = {
  cls?: string | string[];
  text?: string;
  attr?: Record<string, string>;
};

class FakeElement {
  children: FakeElement[] = [];
  dataset: Record<string, string> = {};
  attributes: Record<string, string> = {};
  isConnected = true;
  ownerDocument = { activeElement: null, defaultView: globalThis as unknown as Window };
  parentElement: FakeElement | null = null;
  scrollHeight = 0;
  scrollTop = 0;
  text = '';
  private classes = new Set<string>();

  constructor(options: FakeElementOptions = {}) {
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

  addEventListener(_event: string, _handler: EventListener): void {}

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

  hasClass(cls: string): boolean {
    return this.classes.has(cls);
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
    expect(wrapperEl.findByClass('pivi-subagent-status-dot')).not.toBeNull();
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
});

describe('message actions with running subagents', () => {
  it('keeps copy/navigation actions but withholds fork until the assistant turn is stable', () => {
    const msgEl = new FakeElement({ cls: 'pivi-message' });
    const messagesEl = new FakeElement();
    const msg: ChatMessage = {
      id: 'assistant-1',
      assistantMessageId: 'entry-1',
      role: 'assistant',
      content: 'Main response is still being synthesized',
      contentBlocks: [{ type: 'text', content: 'Main response is still being synthesized' }],
      timestamp: 0,
      toolCalls: [{
        id: 'spawn-1',
        name: 'spawn_agent',
        input: { run_in_background: true },
        status: 'running',
        subagent: createRunningAsyncSubagent(),
      }],
    };

    refreshMessageActions(
      {
        messagesEl: messagesEl as unknown as HTMLElement,
        forkCallback: jest.fn(),
      },
      msgEl as unknown as HTMLElement,
      msg,
    );

    const toolbar = msgEl.findByClass('pivi-message-actions');
    expect(toolbar).not.toBeNull();
    expect(toolbar?.findByClass('pivi-assistant-msg-copy-btn')).not.toBeNull();
    expect(toolbar?.findByClass('pivi-message-scroll-user-btn')).not.toBeNull();
    expect(toolbar?.findByClass('pivi-message-fork-btn')).toBeNull();
  });
});

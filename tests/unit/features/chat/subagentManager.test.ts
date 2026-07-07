import { SubagentManager } from '@/ui/chat/services/SubagentManager';
import { extractFullOutputPath } from '@/ui/chat/services/subagentOutput';
import type { SubagentInfo } from '@pivi/pivi-agent-core/foundation';
import type { TaskResultInterpreter } from '@pivi/pivi-agent-core/tools';

const mockInterpreter: TaskResultInterpreter = {
  hasAsyncLaunchMarker: () => false,
  extractAgentId: () => null,
  extractStructuredResult: () => null,
  resolveTerminalStatus: (_result, fallback) => fallback,
  extractTagValue: () => null,
};

function createManager(onChange = jest.fn()): SubagentManager {
  return new SubagentManager(onChange, mockInterpreter);
}

class FakeElement {
  children: FakeElement[] = [];
  dataset: Record<string, string> = {};
  isConnected = true;
  ownerDocument = { activeElement: null, defaultView: globalThis as unknown as Window };
  parentElement: FakeElement | null = null;
  scrollHeight = 0;
  scrollTop = 0;
  text = '';
  private classes = new Set<string>();

  get className(): string {
    return [...this.classes].join(' ');
  }

  set className(value: string) {
    this.classes = new Set(value.split(/\s+/).filter(Boolean));
  }

  createDiv(options: { cls?: string; text?: string } = {}): FakeElement {
    const child = new FakeElement();
    child.className = options.cls ?? '';
    child.text = options.text ?? '';
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  createSpan(options: { cls?: string; text?: string } = {}): FakeElement {
    return this.createDiv(options);
  }

  addClass(cls: string): void {
    this.classes.add(cls);
  }

  removeClass(cls: string): void {
    this.classes.delete(cls);
  }

  empty(): void {
    this.children = [];
    this.text = '';
  }

  setText(text: string): void {
    this.text = text;
  }

  setAttribute(_name: string, _value: string): void {}

  addEventListener(_event: string, _handler: EventListener): void {}

  querySelector(selector: string): FakeElement | null {
    if (!selector.startsWith('.')) return null;
    const className = selector.slice(1);
    return this.find((child) => child.classes.has(className));
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

describe('SubagentManager', () => {
  it('buffers task tool_use until parent element exists', () => {
    const manager = createManager();
    const result = manager.handleTaskToolUse('task-1', { prompt: 'do thing' }, null);
    expect(result.action).toBe('buffered');
    expect(manager.subagentsSpawnedThisStream).toBe(0);
  });

  it('buffers when run_in_background is not yet known', () => {
    const parent = {} as HTMLElement;
    const manager = createManager();
    const result = manager.handleTaskToolUse('task-2', { prompt: 'sync task' }, parent);
    expect(result.action).toBe('buffered');
    expect(manager.hasPendingTask('task-2')).toBe(true);
  });

  it('renders a pending task at its original parent when mode arrives later', () => {
    const firstParent = new FakeElement();
    const secondParent = new FakeElement();
    const manager = createManager();

    const buffered = manager.handleTaskToolUse(
      'task-anchor',
      { prompt: 'read first' },
      firstParent as unknown as HTMLElement,
    );
    const created = manager.handleTaskToolUse(
      'task-anchor',
      { run_in_background: false },
      secondParent as unknown as HTMLElement,
    );

    expect(buffered.action).toBe('buffered');
    expect(created.action).toBe('created_sync');
    expect(firstParent.children.some((child) => child.className.includes('pivi-subagent-list'))).toBe(true);
    expect(secondParent.children).toHaveLength(0);
  });

  it('resets spawned count on resetSpawnedCount', () => {
    const manager = createManager();
    manager.resetSpawnedCount();
    expect(manager.subagentsSpawnedThisStream).toBe(0);
  });

  it('keeps terminal async subagent info addressable by task id', () => {
    const manager = createManager();
    const info = {
      id: 'spawn-1',
      description: 'Background research',
      prompt: 'Research',
      mode: 'async',
      status: 'completed',
      asyncStatus: 'completed',
      agentId: 'agent-1',
      result: 'Done',
      toolCalls: [],
      isExpanded: false,
    };
    (manager as unknown as {
      asyncDomStates: Map<string, { info: typeof info }>;
      taskIdToAgentId: Map<string, string>;
    }).asyncDomStates.set('spawn-1', { info });
    (manager as unknown as {
      taskIdToAgentId: Map<string, string>;
    }).taskIdToAgentId.set('spawn-1', 'agent-1');

    expect(manager.getByTaskId('spawn-1')).toBe(info);
  });

  it('does not resolve different tool calls through shared purpose state', () => {
    const manager = createManager();
    const first = {
      id: 'spawn-1',
      description: 'Same purpose',
      prompt: 'One',
      mode: 'async',
      status: 'running',
      asyncStatus: 'pending',
      toolCalls: [],
      isExpanded: false,
    };
    const second = {
      ...first,
      id: 'spawn-2',
      prompt: 'Two',
    };
    (manager as unknown as {
      asyncDomStates: Map<string, { info: typeof first }>;
    }).asyncDomStates.set('spawn-1', { info: first });
    (manager as unknown as {
      asyncDomStates: Map<string, { info: typeof second }>;
    }).asyncDomStates.set('spawn-2', { info: second });

    expect(manager.getByTaskId('spawn-1')).toBe(first);
    expect(manager.getByTaskId('spawn-2')).toBe(second);
  });

  it('finalizes a pending async subagent by task id when the result arrives before agent id mapping', () => {
    const onChange = jest.fn();
    const manager = createManager(onChange);
    const info: SubagentInfo = {
      id: 'spawn-1',
      description: 'Read long card',
      prompt: 'Read the card',
      mode: 'async',
      status: 'running',
      asyncStatus: 'pending',
      result: 'Streamed partial result',
      toolCalls: [],
      isExpanded: false,
    };
    (manager as unknown as {
      pendingAsyncSubagents: Map<string, SubagentInfo>;
    }).pendingAsyncSubagents.set('spawn-1', info);

    const handled = manager.handleAsyncSubagentResult(
      'subagent-1',
      'completed',
      'Background task completed.',
      'spawn-1',
    );

    expect(handled).toBe(info);
    expect(info).toMatchObject({
      agentId: 'subagent-1',
      status: 'completed',
      asyncStatus: 'completed',
      result: 'Streamed partial result',
    });
    expect((manager as unknown as {
      pendingAsyncSubagents: Map<string, SubagentInfo>;
    }).pendingAsyncSubagents.has('spawn-1')).toBe(false);
    expect(onChange).toHaveBeenCalledWith(info);
  });
});

describe('subagent output helpers', () => {
  it('extracts a trimmed full output path from truncated output text', () => {
    expect(extractFullOutputPath('before [Truncated. Full output: /tmp/agent.output ] after'))
      .toBe('/tmp/agent.output');
  });

  it('ignores missing full output markers', () => {
    expect(extractFullOutputPath('plain output')).toBeNull();
  });
});

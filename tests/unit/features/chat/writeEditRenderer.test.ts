import type { ToolCallInfo, ToolDiffData } from '@pivi/pivi-agent-core/foundation';
import { TOOL_OBSIDIAN_EDIT } from '@pivi/pivi-agent-core/tools/obsidianToolNames';
import { TOOL_WRITE } from '@pivi/pivi-agent-core/tools/toolNames';
import { setIcon } from 'obsidian';

import { renderStoredWriteEdit } from '@/ui/chat/rendering/WriteEditRenderer';

class FakeElement {
  children: FakeElement[] = [];
  text = '';
  className = '';
  dataset: Record<string, string> = {};
  attributes: Record<string, string> = {};
  private classes = new Set<string>();

  get textContent(): string {
    const own = this.text;
    const nested = this.children.map((child) => child.textContent).join('');
    return own + nested;
  }

  createDiv(options: { cls?: string; text?: string } = {}): FakeElement {
    return this.createChild(options);
  }

  createSpan(options: { cls?: string; text?: string } = {}): FakeElement {
    return this.createChild(options);
  }

  createEl(
    _tag: string,
    options: { cls?: string; text?: string } = {},
  ): FakeElement {
    return this.createChild(options);
  }

  setText(value: string): void {
    this.text = value;
  }

  empty(): void {
    this.children = [];
    this.text = '';
  }

  addClass(name: string): void {
    this.classes.add(name);
    this.className = [...this.classes].join(' ');
  }

  removeClass(name: string): void {
    this.classes.delete(name);
    this.className = [...this.classes].join(' ');
  }

  hasClass(name: string): boolean {
    return this.classes.has(name);
  }

  setAttribute(name: string, value: string): void {
    this.attributes[name] = value;
  }

  addEventListener(_type: string, _listener: EventListener): void {}

  querySelector<T>(selector: string): T | null {
    if (!selector.startsWith('.')) return null;
    return (this.findByClass(selector.slice(1)) as T | undefined) ?? null;
  }

  findByClass(className: string): FakeElement | undefined {
    if (this.classes.has(className)) return this;
    for (const child of this.children) {
      const match = child.findByClass(className);
      if (match) return match;
    }
    return undefined;
  }

  findAllByClass(className: string): FakeElement[] {
    const matches: FakeElement[] = this.classes.has(className) ? [this] : [];
    return [...matches, ...this.children.flatMap((child) => child.findAllByClass(className))];
  }

  private createChild(options: { cls?: string; text?: string }): FakeElement {
    const child = new FakeElement();
    child.text = options.text ?? '';
    if (options.cls) {
      for (const name of options.cls.split(/\s+/).filter(Boolean)) {
        child.addClass(name);
      }
    }
    this.children.push(child);
    return child;
  }
}

function baseToolCall(overrides: Partial<ToolCallInfo> = {}): ToolCallInfo {
  return {
    id: 'tool-1',
    name: TOOL_WRITE,
    input: { file_path: 'vault/notes/demo.md' },
    status: 'completed',
    ...overrides,
  };
}

const sampleDiffData: ToolDiffData = {
  filePath: 'vault/notes/demo.md',
  diffLines: [
    { type: 'delete', text: 'old line' },
    { type: 'insert', text: 'new line' },
  ],
  stats: { added: 1, removed: 1 },
};

describe('renderStoredWriteEdit', () => {
  beforeEach(() => {
    jest.mocked(setIcon).mockClear();
  });

  it('renders a completed write/edit tool call with file path in header/summary', () => {
    const parent = new FakeElement();
    const toolCall = baseToolCall({
      name: TOOL_OBSIDIAN_EDIT,
      input: { path: 'vault/notes/demo.md' },
    });

    const wrapper = renderStoredWriteEdit(
      parent as unknown as HTMLElement,
      toolCall,
    ) as unknown as FakeElement;

    expect(wrapper.hasClass('done')).toBe(true);
    expect(wrapper.dataset.toolId).toBe('tool-1');
    expect(wrapper.findByClass('pivi-write-edit-name')?.text).toBeTruthy();
    expect(wrapper.findByClass('pivi-write-edit-summary')?.text).toBe('edit · vault/notes/demo.md');
    expect(wrapper.findByClass('pivi-write-edit-header')?.attributes['aria-label'])
      .toBe('Edit: edit · vault/notes/demo.md - click to expand');
    expect(wrapper.findByClass('pivi-write-edit-done-text')?.text).toBe('DONE');
  });

  it('renders error state when tool call status indicates failure', () => {
    const parent = new FakeElement();
    const toolCall = baseToolCall({
      status: 'error',
      result: 'Permission denied',
    });

    const wrapper = renderStoredWriteEdit(
      parent as unknown as HTMLElement,
      toolCall,
    ) as unknown as FakeElement;

    expect(wrapper.hasClass('error')).toBe(true);
    expect(wrapper.findByClass('pivi-write-edit-status')?.hasClass('status-error')).toBe(true);
    expect(setIcon).toHaveBeenCalledWith(expect.anything(), 'x');
    expect(wrapper.findByClass('pivi-write-edit-error')?.text).toBe('Permission denied');
  });

  it('treats blocked status as an error state', () => {
    const parent = new FakeElement();
    const toolCall = baseToolCall({
      status: 'blocked',
      result: 'User rejected edit',
    });

    const wrapper = renderStoredWriteEdit(
      parent as unknown as HTMLElement,
      toolCall,
    ) as unknown as FakeElement;

    expect(wrapper.hasClass('error')).toBe(true);
    expect(wrapper.findByClass('pivi-write-edit-error')?.text).toBe('User rejected edit');
  });

  it.each([
    [TOOL_WRITE, { file_path: 'deep/nested/file_path.md' }, 'file_path.md'],
    [TOOL_OBSIDIAN_EDIT, { path: 'other/dir/path.txt' }, 'edit · other/dir/path.txt'],
    [TOOL_OBSIDIAN_EDIT, { file: 'readme.md' }, 'edit · readme.md'],
  ] as const)(
    'uses the canonical summary for %s',
    (name, input, expectedSummary) => {
      const parent = new FakeElement();
      const toolCall = baseToolCall({ name, input });

      const wrapper = renderStoredWriteEdit(
        parent as unknown as HTMLElement,
        toolCall,
      ) as unknown as FakeElement;

      expect(wrapper.findByClass('pivi-write-edit-summary')?.text).toBe(expectedSummary);
    },
  );

  it('renders diff stats and content when diff data is present', () => {
    const parent = new FakeElement();
    const toolCall = baseToolCall({ diffData: sampleDiffData });

    const wrapper = renderStoredWriteEdit(
      parent as unknown as HTMLElement,
      toolCall,
    ) as unknown as FakeElement;

    const stats = wrapper.findByClass('pivi-write-edit-stats');
    expect(stats).toBeDefined();
    expect(stats?.textContent).toContain('+1');
    expect(stats?.textContent).toContain('-1');

    expect(wrapper.findByClass('pivi-write-edit-diff-row')).toBeDefined();
    expect(wrapper.findByClass('pivi-write-edit-diff')).toBeDefined();
    expect(wrapper.textContent).toContain('old line');
    expect(wrapper.textContent).toContain('new line');
  });
});

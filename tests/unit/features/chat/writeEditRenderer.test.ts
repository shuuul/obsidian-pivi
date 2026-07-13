import type { ToolCallInfo, ToolDiffData } from '@pivi/pivi-agent-core/foundation';
import { TOOL_WRITE } from '@pivi/pivi-agent-core/tools/toolNames';

import { renderWriteEditContent } from '@/ui/chat/rendering/WriteEditRenderer';

class FakeElement {
  children: FakeElement[] = [];
  text = '';
  className = '';
  private classes = new Set<string>();

  get textContent(): string {
    return this.text + this.children.map(child => child.textContent).join('');
  }

  createDiv(options: { cls?: string; text?: string } = {}): FakeElement {
    const child = new FakeElement();
    child.text = options.text ?? '';
    for (const name of options.cls?.split(/\s+/).filter(Boolean) ?? []) child.addClass(name);
    this.children.push(child);
    return child;
  }

  createSpan(options: { cls?: string; text?: string } = {}): FakeElement {
    return this.createDiv(options);
  }

  empty(): void {
    this.children = [];
    this.text = '';
  }

  setText(text: string): void {
    this.text = text;
  }

  addClass(name: string): void {
    this.classes.add(name);
    this.className = [...this.classes].join(' ');
  }

  findByClass(className: string): FakeElement | undefined {
    if (this.classes.has(className)) return this;
    for (const child of this.children) {
      const match = child.findByClass(className);
      if (match) return match;
    }
    return undefined;
  }
}

function toolCall(overrides: Partial<ToolCallInfo> = {}): ToolCallInfo {
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

describe('renderWriteEditContent', () => {
  it('renders diff content without creating another tool shell', () => {
    const container = new FakeElement();

    renderWriteEditContent(
      container as unknown as HTMLElement,
      toolCall({ diffData: sampleDiffData }),
    );

    expect(container.className).toContain('pivi-write-edit-content');
    expect(container.findByClass('pivi-write-edit-diff')).toBeDefined();
    expect(container.findByClass('pivi-write-edit-block')).toBeUndefined();
    expect(container.findByClass('pivi-write-edit-header')).toBeUndefined();
    expect(container.textContent).toContain('old line');
    expect(container.textContent).toContain('new line');
  });

  it.each([
    ['error', 'Permission denied'],
    ['blocked', 'User rejected edit'],
  ] as const)('renders %s results in the body', (status, result) => {
    const container = new FakeElement();

    renderWriteEditContent(
      container as unknown as HTMLElement,
      toolCall({ status, result }),
    );

    expect(container.findByClass('pivi-write-edit-error')?.text).toBe(result);
  });

  it('renders a compact completion fallback when no diff is available', () => {
    const container = new FakeElement();

    renderWriteEditContent(container as unknown as HTMLElement, toolCall());

    expect(container.findByClass('pivi-write-edit-done-text')?.text).toBe('DONE');
  });
});

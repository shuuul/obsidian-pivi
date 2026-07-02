import { renderTodoVisualizationPanel } from '@/ui/chat/todo/TodoVisualizationPanel';

class FakeElement {
  children: FakeElement[] = [];
  text = '';
  style: Record<string, string> = {};
  attributes: Record<string, string> = {};
  private classes = new Set<string>();

  createDiv(options: { cls?: string; text?: string } = {}): FakeElement {
    return this.appendChild(options);
  }

  createSpan(options: { cls?: string; text?: string } = {}): FakeElement {
    return this.appendChild(options);
  }

  addClass(className: string): void {
    for (const name of className.split(/\s+/).filter(Boolean)) {
      this.classes.add(name);
    }
  }

  empty(): void {
    this.children = [];
    this.text = '';
  }

  setAttribute(name: string, value: string): void {
    this.attributes[name] = value;
  }

  setText(text: string): void {
    this.text = text;
  }

  hasClass(className: string): boolean {
    return this.classes.has(className);
  }

  findByClass(className: string): FakeElement | undefined {
    if (this.classes.has(className)) return this;
    for (const child of this.children) {
      const result = child.findByClass(className);
      if (result) return result;
    }
    return undefined;
  }

  private appendChild(options: { cls?: string; text?: string }): FakeElement {
    const child = new FakeElement();
    if (options.cls) child.addClass(options.cls);
    child.text = options.text ?? '';
    this.children.push(child);
    return child;
  }
}

describe('TodoVisualizationPanel', () => {
  it('renders a minimal todo visualization panel', () => {
    const container = new FakeElement();

    renderTodoVisualizationPanel(container as unknown as HTMLElement, {
      source: 'tool',
      activeItemId: 'b',
      progress: { total: 2, completed: 1, inProgress: 1, pending: 0 },
      items: [
        { id: 'a', content: 'Done', status: 'completed' },
        { id: 'b', content: 'Run tests', activeForm: 'Running tests', status: 'in_progress' },
      ],
    });

    expect(container.hasClass('pivi-todo-panel')).toBe(true);
    expect(container.attributes['data-pivi-todo-source']).toBe('tool');
    expect(container.findByClass('pivi-todo-progress-summary')?.text).toBe('Tasks 1/2');
    expect(container.findByClass('pivi-todo-in_progress')).toBeDefined();
  });
});

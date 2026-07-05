import { TOOL_SKILL } from '@pivi/pivi-agent-core/tools/toolNames';
import { renderExpandedContent } from '@/ui/chat/rendering/toolCallExpandedDispatcher';

class FakeElement {
  children: FakeElement[] = [];
  text = '';

  get textContent(): string {
    const own = this.text;
    const nested = this.children.map((child) => child.textContent).join('');
    return own + nested;
  }

  createDiv(options: { cls?: string; text?: string } = {}): FakeElement {
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

  createSpan(options: { cls?: string; text?: string } = {}): FakeElement {
    return this.createDiv(options);
  }

  createEl(
    _tag: string,
    options: { cls?: string; text?: string } = {},
  ): FakeElement {
    return this.createDiv(options);
  }

  setText(value: string): void {
    this.text = value;
  }

  empty(): void {
    this.children = [];
    this.text = '';
  }

  addClass(_name: string): void {
    // no-op for aggregate text assertions
  }
}

const skillInstructionResult = [
  '<skill name="demo" location="/vault/.pivi/skills/demo/SKILL.md">',
  'References are relative to /vault/.pivi/skills/demo.',
  '',
  '# Full instructions',
  'Follow these steps.',
  '</skill>',
].join('\n');

describe('renderExpandedContent skill preview', () => {
  it('renders details.description and hides full skill instruction body', () => {
    const root = new FakeElement();

    renderExpandedContent(
      root as unknown as HTMLElement,
      TOOL_SKILL,
      skillInstructionResult,
      { name: 'demo' },
      { description: 'Demo skill description.' },
    );

    expect(root.textContent).toContain('Demo skill description.');
    expect(root.textContent).not.toContain('Full instructions');
    expect(root.textContent).not.toContain('Follow these steps');
  });

  it('shows a fixed empty state when skill result has no description detail', () => {
    const root = new FakeElement();

    renderExpandedContent(
      root as unknown as HTMLElement,
      TOOL_SKILL,
      skillInstructionResult,
      { name: 'demo' },
    );

    expect(root.textContent).toContain('No description available.');
    expect(root.textContent).not.toContain('Full instructions');
    expect(root.textContent).not.toContain('Follow these steps');
  });

  it('renders non-skill error text for failed skill tool calls', () => {
    const root = new FakeElement();
    const errorText = 'Unknown skill "missing". Available: demo';

    renderExpandedContent(
      root as unknown as HTMLElement,
      TOOL_SKILL,
      errorText,
      { name: 'missing' },
      undefined,
    );

    expect(root.textContent).toContain(errorText);
  });
});
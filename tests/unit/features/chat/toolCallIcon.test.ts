import { TOOL_READ } from '@pivi/pivi-agent-core/tools/toolNames';
import { setIcon } from 'obsidian';

import { appendToolIcon } from '@/ui/chat/rendering/toolCallIcon';

class FakeElement {
  readonly children: FakeElement[] = [];
  readonly ownerDocument = {
    createElementNS: (_namespace: string, tagName: string): FakeElement => new FakeElement(tagName),
  };
  textContent = '';

  constructor(readonly tagName = 'span') {}

  empty(): void {
    this.children.length = 0;
  }

  appendChild(child: FakeElement): FakeElement {
    this.children.push(child);
    return child;
  }

  setAttribute(_name: string, _value: string): void {}

  querySelectorAll(tagName: string): FakeElement[] {
    return this.children.flatMap(child => [
      ...(child.tagName === tagName ? [child] : []),
      ...child.querySelectorAll(tagName),
    ]);
  }
}

function createElement(): HTMLElement {
  return new FakeElement() as unknown as HTMLElement;
}

describe('appendToolIcon', () => {
  beforeEach(() => {
    jest.mocked(setIcon).mockClear();
  });

  it('uses Obsidian icons for regular tools', () => {
    const el = createElement();

    appendToolIcon(el, TOOL_READ);

    expect(setIcon).toHaveBeenCalledWith(el, 'file-text');
  });

  it('uses the MCP SVG for MCP pseudo-tools', () => {
    const el = createElement();

    appendToolIcon(el, 'mcp__server__tool');

    expect(el.querySelectorAll('svg')).toHaveLength(1);
    expect(setIcon).not.toHaveBeenCalled();
  });

  it('clears stale icon children before appending', () => {
    const el = createElement();

    appendToolIcon(el, 'mcp__server__tool');
    appendToolIcon(el, 'mcp__server__tool');

    expect(el.querySelectorAll('svg')).toHaveLength(1);
  });
});

import type { ToolCallInfo } from '@pivi/pivi-agent-core/foundation';
import { TOOL_OBSIDIAN_SEARCH } from '@pivi/pivi-agent-core/tools/obsidianToolNames';
import { TOOL_BASH } from '@pivi/pivi-agent-core/tools/toolNames';

import { renderStoredToolCall } from '@/ui/chat/rendering/ToolCallRenderer';

interface ElementOptions {
  attr?: Record<string, string>;
  cls?: string | string[];
  text?: string;
}

function applyOptions(element: HTMLElement, options: ElementOptions): void {
  const classes = Array.isArray(options.cls) ? options.cls : options.cls?.split(/\s+/);
  if (classes) element.classList.add(...classes.filter(Boolean));
  for (const [name, value] of Object.entries(options.attr ?? {})) {
    element.setAttribute(name, value);
  }
  if (options.text !== undefined) element.textContent = options.text;
}

beforeAll(() => {
  Object.defineProperties(HTMLElement.prototype, {
    createEl: {
      configurable: true,
      value(this: HTMLElement, tagName: string, options: ElementOptions = {}) {
        const element = this.ownerDocument.createElement(tagName);
        applyOptions(element, options);
        this.appendChild(element);
        return element;
      },
    },
    createSpan: {
      configurable: true,
      value(this: HTMLElement, options: ElementOptions = {}) {
        const span = this.ownerDocument.createElement('span');
        applyOptions(span, options);
        this.appendChild(span);
        return span;
      },
    },
    removeClass: {
      configurable: true,
      value(this: HTMLElement, ...classes: string[]) {
        this.classList.remove(...classes);
      },
    },
    setText: {
      configurable: true,
      value(this: HTMLElement, text: string) {
        this.textContent = text;
      },
    },
  });
});

describe('imperative stored tool-call header', () => {
  it('uses the shared translated title, result-aware summary, class, and aria label', () => {
    const parent = document.createElement('div');
    const result = JSON.stringify([{ path: 'month/2026-2.md', line: 7 }]);
    const toolCall: ToolCallInfo = {
      id: 'search-1',
      name: TOOL_OBSIDIAN_SEARCH,
      input: { query: '*', path: 'month' },
      result,
      status: 'completed',
    };

    const toolElement = renderStoredToolCall(parent, toolCall);
    const header = toolElement.querySelector('.pivi-tool-header');

    expect(toolElement).toHaveClass('pivi-tool-call-obsidian');
    expect(toolElement.querySelector('.pivi-tool-name')).toHaveTextContent('Search');
    expect(toolElement.querySelector('.pivi-tool-summary'))
      .toHaveTextContent('* · month · month/2026-2.md:7');
    expect(header).toHaveAttribute(
      'aria-label',
      'Search: * · month · month/2026-2.md:7 - click to expand',
    );
  });

  it('applies descriptor-owned shell classes to imperative rows', () => {
    const parent = document.createElement('div');
    const toolCall: ToolCallInfo = {
      id: 'bash-1',
      name: TOOL_BASH,
      input: { command: 'pwd' },
      result: '/vault',
      status: 'completed',
    };

    const toolElement = renderStoredToolCall(parent, toolCall);

    expect(toolElement).toHaveClass('pivi-tool-call-bash');
    expect(toolElement.querySelector('.pivi-tool-header'))
      .toHaveAttribute('aria-label', 'Bash: pwd - click to expand');
  });
});

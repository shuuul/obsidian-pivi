import type { ToolCallInfo } from '@pivi/pivi-agent-core/foundation';
import {
  TOOL_OBSIDIAN_MARKDOWN_STRUCTURE,
  TOOL_OBSIDIAN_READ,
  TOOL_OBSIDIAN_SEARCH,
} from '@pivi/pivi-agent-core/tools/obsidianToolNames';
import { TOOL_BASH } from '@pivi/pivi-agent-core/tools/toolNames';

import { renderStoredToolCall } from '@/ui/chat/rendering/ToolCallRenderer';
import { renderObsidianMarkdownStructureExpanded } from '@/ui/chat/rendering/toolCallObsidianExpanded';

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
    createDiv: {
      configurable: true,
      value(this: HTMLElement, options: ElementOptions = {}) {
        const div = this.ownerDocument.createElement('div');
        applyOptions(div, options);
        this.appendChild(div);
        return div;
      },
    },
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

  it('renders completed Markdown reads through the injected Obsidian renderer', async () => {
    const parent = document.createElement('div');
    const renderMarkdown = jest.fn(async (
      container: HTMLElement,
      markdown: string,
      sourcePath: string,
    ) => {
      const heading = container.ownerDocument.createElement('h1');
      heading.textContent = markdown.replace(/^# /, '');
      container.appendChild(heading);
      expect(sourcePath).toBe('notes/example.md');
    });
    const toolCall: ToolCallInfo = {
      id: 'read-1',
      name: TOOL_OBSIDIAN_READ,
      input: { path: 'example' },
      result: '# Heading',
      toolUseResult: { path: 'notes/example.md' },
      status: 'completed',
    };

    const toolElement = renderStoredToolCall(parent, toolCall, { renderMarkdown });
    await Promise.resolve();

    expect(renderMarkdown).toHaveBeenCalledWith(
      expect.any(HTMLElement),
      '# Heading',
      'notes/example.md',
    );
    expect(toolElement.querySelector('.pivi-tool-read-markdown h1')).toHaveTextContent('Heading');
  });
});

describe('Obsidian outline preview', () => {
  it('renders a valid structure as a YAML list instead of JSON', () => {
    const container = document.createElement('div');
    renderObsidianMarkdownStructureExpanded(container, JSON.stringify({
      path: 'notes/example.md',
      lines: 12,
      characters: 120,
      headings: [{
        level: 1,
        text: 'Overview',
        line: 1,
        sectionChars: 120,
        charStart: 0,
        charsSincePreviousHeading: 0,
      }],
      truncated: false,
      totalHeadings: 1,
    }));

    expect(container.textContent).toContain('path: "notes/example.md"');
    expect(container.textContent).toContain('headings:');
    expect(container.textContent).toContain('  - level: 1');
    expect(container.textContent).toContain('    text: "Overview"');
    expect(container.textContent).not.toContain('{');
  });

  it('renders an empty outline explicitly', () => {
    const container = document.createElement('div');
    renderObsidianMarkdownStructureExpanded(container, JSON.stringify({
      path: 'empty.md',
      lines: 1,
      characters: 0,
      headings: [],
      truncated: false,
      totalHeadings: 0,
    }));

    expect(container.textContent).toContain('headings: []');
  });

  it('falls back to raw lines when the outline result is malformed', () => {
    const container = document.createElement('div');
    renderObsidianMarkdownStructureExpanded(container, '{broken');

    expect(container.textContent).toContain('{broken');
  });

  it('dispatches the outline tool to the YAML renderer', () => {
    const parent = document.createElement('div');
    const toolCall: ToolCallInfo = {
      id: 'outline-1',
      name: TOOL_OBSIDIAN_MARKDOWN_STRUCTURE,
      input: { path: 'empty.md' },
      result: JSON.stringify({
        path: 'empty.md',
        lines: 1,
        characters: 0,
        headings: [],
        truncated: false,
        totalHeadings: 0,
      }),
      status: 'completed',
    };

    const toolElement = renderStoredToolCall(parent, toolCall);

    expect(toolElement.querySelector('.pivi-tool-content')).toHaveTextContent('headings: []');
  });
});

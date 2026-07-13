import type { ToolCallInfo } from '@pivi/pivi-agent-core/foundation';
import { TOOL_ASK_USER_QUESTION } from '@pivi/pivi-agent-core/tools/toolNames';

import {
  formatAnswer,
  renderAskUserQuestionFallback,
  renderAskUserQuestionResult,
  resolveAskUserAnswers,
} from '@/ui/chat/rendering/toolCallAskUserExpanded';

class FakeElement {
  children: FakeElement[] = [];
  text = '';
  private classes = new Set<string>();

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

  setText(value: string): void {
    this.text = value;
  }

  empty(): void {
    this.children = [];
    this.text = '';
  }

  addClass(name: string): void {
    this.classes.add(name);
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

function baseAskUserToolCall(overrides: Partial<ToolCallInfo> = {}): ToolCallInfo {
  return {
    id: 'ask-1',
    name: TOOL_ASK_USER_QUESTION,
    input: {},
    status: 'completed',
    ...overrides,
  };
}

describe('formatAnswer', () => {
  it('formats string answers', () => {
    expect(formatAnswer('Option A')).toBe('Option A');
  });

  it('formats array answers as comma-separated text', () => {
    expect(formatAnswer(['Red', 'Blue'])).toBe('Red, Blue');
  });

  it('returns empty string for non-string non-array values', () => {
    expect(formatAnswer({ selected: 'A' })).toBe('');
    expect(formatAnswer(42)).toBe('');
  });
});

describe('resolveAskUserAnswers', () => {
  it('returns pre-resolved answers when already on the tool call', () => {
    const toolCall = baseAskUserToolCall({
      resolvedAnswers: { pick: 'Option A' },
    });

    expect(resolveAskUserAnswers(toolCall)).toEqual({ pick: 'Option A' });
  });

  it('parses answers from result text when resolvedAnswers is missing', () => {
    const toolCall = baseAskUserToolCall({
      result: '{"answers":{"Favorite color":"Blue"}}',
    });

    expect(resolveAskUserAnswers(toolCall)).toEqual({ 'Favorite color': 'Blue' });
    expect(toolCall.resolvedAnswers).toEqual({ 'Favorite color': 'Blue' });
  });

  it('returns undefined when no structured or text answers exist', () => {
    const toolCall = baseAskUserToolCall({ result: 'Waiting for user response' });

    expect(resolveAskUserAnswers(toolCall)).toBeUndefined();
  });
});

describe('renderAskUserQuestionResult', () => {
  it('returns true and writes answers when structured answers are present', () => {
    const container = new FakeElement();
    const toolCall = baseAskUserToolCall({
      input: {
        questions: [
          {
            question: 'Pick one',
            id: 'pick',
            header: 'Pick',
            options: [],
            multiSelect: false,
          },
          {
            question: 'Colors?',
            id: 'colors',
            header: 'Colors',
            options: [],
            multiSelect: true,
          },
        ],
      },
      resolvedAnswers: {
        pick: 'Option A',
        colors: ['Red', 'Blue'],
      },
    });

    const rendered = renderAskUserQuestionResult(
      container as unknown as HTMLElement,
      toolCall,
    );

    expect(rendered).toBe(true);
    expect(container.textContent).toContain('Pick one');
    expect(container.textContent).toContain('Option A');
    expect(container.textContent).toContain('Colors?');
    expect(container.textContent).toContain('Red, Blue');
    expect(container.findByClass('pivi-ask-review')).toBeDefined();
  });

  it('returns false when answers are missing', () => {
    const container = new FakeElement();
    const toolCall = baseAskUserToolCall({
      input: {
        questions: [
          {
            question: 'Pick one',
            id: 'pick',
            header: 'Pick',
            options: [],
            multiSelect: false,
          },
        ],
      },
      result: 'Waiting for user response',
    });

    expect(resolveAskUserAnswers(toolCall)).toBeUndefined();
    expect(
      renderAskUserQuestionResult(container as unknown as HTMLElement, toolCall),
    ).toBe(false);
    expect(container.children).toHaveLength(0);
  });
});

describe('renderAskUserQuestionFallback', () => {
  it('writes questions and options into the container without throwing', () => {
    const container = new FakeElement();
    const toolCall = baseAskUserToolCall({
      input: {
        questions: [
          {
            question: 'Choose a mode',
            header: 'Mode',
            options: [{ label: 'Fast', description: 'Lower latency' }],
            multiSelect: false,
          },
        ],
      },
      result: 'Please answer the questions below.',
    });

    expect(() =>
      renderAskUserQuestionFallback(container as unknown as HTMLElement, toolCall),
    ).not.toThrow();

    expect(container.textContent).toContain('Please answer the questions below.');
    expect(container.textContent).toContain('Choose a mode');
    expect(container.textContent).toContain('Fast');
    expect(container.textContent).toContain('Lower latency');
    expect(container.findByClass('pivi-ask-review-prompt')).toBeDefined();
    expect(container.findByClass('pivi-ask-list')).toBeDefined();
  });

  it('uses content fallback when no questions are recorded', () => {
    const container = new FakeElement();
    const toolCall = baseAskUserToolCall({
      result: 'Awaiting response',
    });

    renderAskUserQuestionFallback(container as unknown as HTMLElement, toolCall);

    expect(container.textContent).toContain('Awaiting response');
  });
});

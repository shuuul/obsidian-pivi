import { setIcon } from 'obsidian';

import { renderQueueIndicator } from '../../../../src/features/chat/controllers/inputQueueIndicator';
import type { QueuedMessage } from '../../../../src/features/chat/state/types';

class FakeElement {
  children: FakeElement[] = [];
  text = '';
  private classes = new Set<string>();
  private attributes = new Map<string, string>();
  private listeners = new Map<string, Array<(event: FakeEvent) => void>>();

  constructor(cls = '') {
    for (const name of cls.split(/\s+/).filter(Boolean)) {
      this.classes.add(name);
    }
  }

  createDiv(options?: FakeElementOptions): FakeElement {
    return this.appendChild(options);
  }

  createSpan(options?: FakeElementOptions): FakeElement {
    return this.appendChild(options);
  }

  createEl(_tag: string, options?: FakeElementOptions): FakeElement {
    const child = this.appendChild(options);
    for (const [name, value] of Object.entries(options?.attr ?? {})) {
      child.setAttribute(name, value);
    }
    return child;
  }

  empty(): void {
    this.children = [];
  }

  addEventListener(eventName: string, callback: (event: FakeEvent) => void): void {
    const listeners = this.listeners.get(eventName) ?? [];
    listeners.push(callback);
    this.listeners.set(eventName, listeners);
  }

  click(): FakeEvent {
    return this.dispatch('click');
  }

  dispatch(eventName: string): FakeEvent {
    const event = {
      stopPropagation: jest.fn(),
    };
    for (const listener of this.listeners.get(eventName) ?? []) {
      listener(event);
    }
    return event;
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  getAttribute(name: string): string | undefined {
    return this.attributes.get(name);
  }

  addClass(name: string): void {
    this.classes.add(name);
  }

  removeClass(name: string): void {
    this.classes.delete(name);
  }

  hasClass(name: string): boolean {
    return this.classes.has(name);
  }

  findByText(text: string): FakeElement | undefined {
    if (this.text === text) return this;
    for (const child of this.children) {
      const result = child.findByText(text);
      if (result) return result;
    }
    return undefined;
  }

  findByClass(className: string): FakeElement | undefined {
    if (this.classes.has(className)) return this;
    for (const child of this.children) {
      const result = child.findByClass(className);
      if (result) return result;
    }
    return undefined;
  }

  private appendChild(options?: FakeElementOptions): FakeElement {
    const child = new FakeElement(options?.cls);
    child.text = options?.text ?? '';
    this.children.push(child);
    return child;
  }
}

type FakeElementOptions = {
  cls?: string;
  text?: string;
  attr?: Record<string, string>;
};

type FakeEvent = {
  stopPropagation: jest.Mock;
};

function createMessage(content: string): QueuedMessage {
  return {
    content,
    editorContext: null,
    canvasContext: null,
  };
}

function render(options: Partial<Parameters<typeof renderQueueIndicator>[0]> = {}): {
  indicatorEl: FakeElement;
  onSteer: jest.Mock;
  onEdit: jest.Mock;
  onDiscard: jest.Mock;
} {
  const indicatorEl = new FakeElement();
  const onSteer = jest.fn();
  const onEdit = jest.fn();
  const onDiscard = jest.fn();

  renderQueueIndicator({
    indicatorEl: indicatorEl as unknown as HTMLElement,
    queuedMessage: null,
    pendingSteerMessage: null,
    canSteer: false,
    steerInFlight: false,
    onSteer,
    onEdit,
    onDiscard,
    ...options,
  });

  return { indicatorEl, onSteer, onEdit, onDiscard };
}

describe('renderQueueIndicator', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('hides the indicator when no queued message is visible', () => {
    const { indicatorEl } = render();

    expect(indicatorEl.children).toHaveLength(0);
    expect(indicatorEl.hasClass('pivi-hidden')).toBe(true);
    expect(indicatorEl.hasClass('pivi-visible-flex')).toBe(false);
  });

  it('renders queued message actions and invokes callbacks', () => {
    const { indicatorEl, onSteer, onEdit, onDiscard } = render({
      queuedMessage: createMessage('please continue'),
      canSteer: true,
    });

    expect(indicatorEl.findByText('⌙ Queued: please continue')).toBeDefined();
    expect(indicatorEl.findByText('Steer Now')).toBeDefined();
    expect(indicatorEl.hasClass('pivi-visible-flex')).toBe(true);
    expect(setIcon).toHaveBeenCalledWith(expect.anything(), 'pencil');
    expect(setIcon).toHaveBeenCalledWith(expect.anything(), 'trash-2');

    const steerEvent = indicatorEl.findByText('Steer Now')?.click();
    const editEvent = indicatorEl.children[1]?.children[1]?.click();
    const discardEvent = indicatorEl.children[1]?.children[2]?.click();

    expect(onSteer).toHaveBeenCalledTimes(1);
    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(onDiscard).toHaveBeenCalledTimes(1);
    expect(steerEvent?.stopPropagation).toHaveBeenCalled();
    expect(editEvent?.stopPropagation).toHaveBeenCalled();
    expect(discardEvent?.stopPropagation).toHaveBeenCalled();
  });

  it('shows steering in-flight as disabled', () => {
    const { indicatorEl, onSteer } = render({
      queuedMessage: createMessage('please continue'),
      canSteer: true,
      steerInFlight: true,
    });

    const steerButton = indicatorEl.findByText('Steering...');
    expect(steerButton?.getAttribute('disabled')).toBe('true');

    steerButton?.click();
    expect(onSteer).not.toHaveBeenCalled();
  });

  it('renders pending steering state without queued-message actions', () => {
    const { indicatorEl } = render({
      pendingSteerMessage: createMessage('adjust course'),
      canSteer: true,
    });

    expect(indicatorEl.findByText('⌙ Steering: adjust course')).toBeDefined();
    expect(indicatorEl.findByClass('pivi-queue-indicator-actions')).toBeUndefined();
  });
});

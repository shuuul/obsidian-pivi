import type { SlashCatalogEntry } from '@pivi/pivi-agent-core/skills/commands/slashCommandEntry';
import { setIcon } from 'obsidian';

import { SlashCommandDropdown } from '@/ui/shared/components/SlashCommandDropdown';
import { appendMcpIcon } from '@/ui/shared/utils/icons';

jest.mock('@/ui/shared/utils/icons', () => ({ appendMcpIcon: jest.fn() }));

type ElementOptions = { cls?: string; text?: string };

class FakeElement {
  readonly children: FakeElement[] = [];
  readonly classes = new Set<string>();
  readonly listeners = new Map<string, Set<EventListener>>();
  removed = false;
  text = '';
  readonly cssProps: Record<string, string> = {};

  constructor(classes = '') {
    for (const className of classes.split(/\s+/).filter(Boolean)) {
      this.classes.add(className);
    }
  }

  createDiv(options: ElementOptions = {}): FakeElement {
    return this.createChild(options);
  }

  createSpan(options: ElementOptions = {}): FakeElement {
    return this.createChild(options);
  }

  private createChild(options: ElementOptions): FakeElement {
    const child = new FakeElement(options.cls);
    child.text = options.text ?? '';
    this.children.push(child);
    return child;
  }

  addClass(className: string): void {
    this.classes.add(className);
  }

  removeClass(className: string): void {
    this.classes.delete(className);
  }

  hasClass(className: string): boolean {
    return this.classes.has(className);
  }

  empty(): void {
    this.children.length = 0;
  }

  remove(): void {
    this.removed = true;
  }

  setText(text: string): void {
    this.text = text;
  }

  setAttribute(): void {}
  setCssProps(props: Record<string, string>): void {
    Object.assign(this.cssProps, props);
  }

  addEventListener(type: string, listener: EventListener): void {
    const listeners = this.listeners.get(type) ?? new Set<EventListener>();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  querySelector(selector: string): FakeElement | null {
    return this.querySelectorAll(selector)[0] ?? null;
  }

  querySelectorAll(selector: string): FakeElement[] {
    if (!selector.startsWith('.')) return [];
    const classNames = selector.slice(1).split('.');
    return this.descendants().filter(
      (element) => classNames.every((className) => element.hasClass(className)),
    );
  }

  private descendants(): FakeElement[] {
    return this.children.flatMap((child) => [child, ...child.descendants()]);
  }

  getBoundingClientRect(): DOMRect {
    return {
      bottom: 100,
      height: 20,
      left: 0,
      right: 400,
      top: 80,
      width: 400,
      x: 0,
      y: 80,
      toJSON: () => ({}),
    };
  }

  scrollIntoView(): void {}
}

class FakeInput extends FakeElement {
  value = '';
  selectionStart = 0;
  selectionEnd = 0;
  focus = jest.fn();

  removeEventListener(type: string, listener: EventListener): void {
    this.listeners.get(type)?.delete(listener);
  }
}

function catalogEntry(
  name: string,
  kind: SlashCatalogEntry['kind'] = 'command',
): SlashCatalogEntry {
  return {
    id: `command:${name}`,
    name,
    content: '',
    scope: 'workspace',
    source: 'user',
    kind,
    ...(kind === 'tool' ? { toolName: 'obsidian_generate_image' } : {}),
    isEditable: true,
    isDeletable: true,
    displayPrefix: '/',
    insertPrefix: '/',
  };
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

async function flushAsyncDropdown(): Promise<void> {
  for (let i = 0; i < 8; i++) {
    await Promise.resolve();
  }
}

function keyboardEvent(key: string, isComposing = false): KeyboardEvent {
  return {
    isComposing,
    key,
    preventDefault: jest.fn(),
  } as unknown as KeyboardEvent;
}

function setInput(input: FakeInput, value: string): void {
  input.value = value;
  input.selectionStart = value.length;
  input.selectionEnd = value.length;
}

describe('SlashCommandDropdown controller', () => {
  it('renders distinct icons for skills, commands, and MCP entries', async () => {
    jest.mocked(setIcon).mockClear();
    const container = new FakeElement();
    const input = new FakeInput();
    const dropdown = new SlashCommandDropdown(
      container as unknown as HTMLElement,
      input as unknown as HTMLTextAreaElement,
      { onSelect: jest.fn() },
      {
        getSkills: () => [{ name: 'review' }],
        getCatalogEntries: async () => [
          catalogEntry('explain'),
          catalogEntry('generate-image', 'tool'),
        ],
        getMcpManager: () => ({
          getServers: () => [{ name: 'notes', enabled: true }],
        }),
        getMcpToolProvider: () => ({ listTools: async () => [] }),
      },
    );

    setInput(input, '/');
    dropdown.handleInputChange();
    await flushAsyncDropdown();

    expect(container.querySelectorAll('.pivi-slash-icon--skill').length).toBeGreaterThan(0);
    expect(container.querySelectorAll('.pivi-slash-icon--command').length).toBeGreaterThan(0);
    expect(container.querySelectorAll('.pivi-slash-icon--tool').length).toBeGreaterThan(0);
    expect(container.querySelectorAll('.pivi-slash-icon--mcp').length).toBeGreaterThan(0);
    expect(setIcon).toHaveBeenCalledWith(expect.anything(), 'sparkles');
    expect(setIcon).toHaveBeenCalledWith(expect.anything(), 'terminal');
    expect(setIcon).toHaveBeenCalledWith(expect.anything(), 'image-plus');
    expect(appendMcpIcon).toHaveBeenCalled();
    expect(container.querySelector('.pivi-slash-detail')?.cssProps).toMatchObject({
      '--pivi-slash-detail-max-width': '0px',
    });
  });

  it('keeps tool tokens in the composer without invoking command callbacks', async () => {
    const container = new FakeElement();
    const input = new FakeInput();
    const onSelect = jest.fn();
    const dropdown = new SlashCommandDropdown(
      container as unknown as HTMLElement,
      input as unknown as HTMLTextAreaElement,
      { onSelect },
      { getCatalogEntries: async () => [catalogEntry('generate-image', 'tool')] },
    );

    setInput(input, '/gen');
    dropdown.handleInputChange();
    await flushAsyncDropdown();

    expect(dropdown.handleKeydown(keyboardEvent('Enter'))).toBe(true);
    expect(input.value).toBe('/generate-image ');
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('does not consume Enter or Tab while an IME composition is active', async () => {
    const container = new FakeElement();
    const input = new FakeInput();
    const onSelect = jest.fn();
    const dropdown = new SlashCommandDropdown(
      container as unknown as HTMLElement,
      input as unknown as HTMLTextAreaElement,
      { onSelect },
      { getSkills: () => [{ name: 'summarize' }] },
    );

    setInput(input, '/sum');
    dropdown.handleInputChange();
    await flushAsyncDropdown();

    expect(dropdown.isVisible()).toBe(true);
    expect(dropdown.handleKeydown(keyboardEvent('Enter', true))).toBe(false);
    expect(dropdown.handleKeydown(keyboardEvent('Tab', true))).toBe(false);
    expect(input.value).toBe('/sum');
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('does not let an older catalog request overwrite the latest cache', async () => {
    const first = deferred<SlashCatalogEntry[]>();
    const second = deferred<SlashCatalogEntry[]>();
    const getCatalogEntries = jest.fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const container = new FakeElement();
    const input = new FakeInput();
    const dropdown = new SlashCommandDropdown(
      container as unknown as HTMLElement,
      input as unknown as HTMLTextAreaElement,
      { onSelect: jest.fn() },
      { getCatalogEntries },
    );

    setInput(input, '/fir');
    dropdown.handleInputChange();
    setInput(input, '/sec');
    dropdown.handleInputChange();

    second.resolve([catalogEntry('second')]);
    await flushAsyncDropdown();
    first.resolve([catalogEntry('first')]);
    await flushAsyncDropdown();

    setInput(input, '/sec');
    dropdown.handleInputChange();
    await flushAsyncDropdown();
    expect(dropdown.isVisible()).toBe(true);

    expect(dropdown.handleKeydown(keyboardEvent('Enter'))).toBe(true);
    expect(input.value).toBe('/second ');
  });

  it('does not reopen after the trigger is removed while a request is pending', async () => {
    const catalog = deferred<SlashCatalogEntry[]>();
    const container = new FakeElement();
    const input = new FakeInput();
    const dropdown = new SlashCommandDropdown(
      container as unknown as HTMLElement,
      input as unknown as HTMLTextAreaElement,
      { onSelect: jest.fn() },
      { getCatalogEntries: () => catalog.promise },
    );

    setInput(input, '/pending');
    dropdown.handleInputChange();
    setInput(input, 'plain text');
    dropdown.handleInputChange();
    catalog.resolve([catalogEntry('late')]);
    await flushAsyncDropdown();

    expect(dropdown.isVisible()).toBe(false);
    expect(container.hasClass('pivi-slash-dropdown-open')).toBe(false);
  });

  it('keeps cache invalidation monotonic while an older request is pending', async () => {
    const first = deferred<SlashCatalogEntry[]>();
    const second = deferred<SlashCatalogEntry[]>();
    const getCatalogEntries = jest.fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const container = new FakeElement();
    const input = new FakeInput();
    const dropdown = new SlashCommandDropdown(
      container as unknown as HTMLElement,
      input as unknown as HTMLTextAreaElement,
      { onSelect: jest.fn() },
      { getCatalogEntries },
    );

    setInput(input, '/old');
    dropdown.handleInputChange();
    dropdown.resetRuntimeSkillsCache();
    setInput(input, '/new');
    dropdown.handleInputChange();
    second.resolve([catalogEntry('new')]);
    await flushAsyncDropdown();
    first.resolve([catalogEntry('old')]);
    await flushAsyncDropdown();

    expect(dropdown.handleKeydown(keyboardEvent('Enter'))).toBe(true);
    expect(input.value).toBe('/new ');
  });

  it('invalidates pending requests and removes the input listener on destroy', async () => {
    const catalog = deferred<SlashCatalogEntry[]>();
    const container = new FakeElement();
    const input = new FakeInput();
    const dropdown = new SlashCommandDropdown(
      container as unknown as HTMLElement,
      input as unknown as HTMLTextAreaElement,
      { onSelect: jest.fn() },
      { getCatalogEntries: () => catalog.promise },
    );

    setInput(input, '/lat');
    dropdown.handleInputChange();
    expect(input.listeners.get('input')?.size).toBe(1);

    dropdown.destroy();
    catalog.resolve([catalogEntry('late')]);
    await flushAsyncDropdown();

    expect(input.listeners.get('input')?.size).toBe(0);
    expect(container.children).toHaveLength(0);
    expect(container.hasClass('pivi-slash-dropdown-open')).toBe(false);
  });
});

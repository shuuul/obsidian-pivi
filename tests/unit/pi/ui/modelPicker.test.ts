import { renderAddProviderPicker } from '@/ui/settings/models-settings/modelPicker';

jest.mock('@pivi/pivi-agent-core/foundation/providerLogos', () => ({
  getProviderLogoSlug: () => null,
  getLogoSlugForCustomProviderKind: () => null,
}));

class FakeElement {
  children: FakeElement[] = [];
  parent: FakeElement | null = null;
  text = '';
  disabled = false;
  ownerDocument = { addEventListener: jest.fn() };
  private classes = new Set<string>();
  private listeners = new Map<string, Array<(event: { stopPropagation: () => void }) => void>>();

  constructor(cls = '') {
    for (const name of cls.split(/\s+/).filter(Boolean)) {
      this.classes.add(name);
    }
  }

  createDiv(options?: { cls?: string; text?: string }): FakeElement {
    return this.appendChild(options);
  }

  createSpan(options?: { cls?: string; text?: string }): FakeElement {
    return this.appendChild(options);
  }

  createEl(_tag: string, options?: { cls?: string; text?: string; type?: string }): FakeElement {
    return this.appendChild(options);
  }

  addEventListener(eventName: string, callback: (event: { stopPropagation: () => void }) => void): void {
    const listeners = this.listeners.get(eventName) ?? [];
    listeners.push(callback);
    this.listeners.set(eventName, listeners);
  }

  click(): void {
    for (const listener of this.listeners.get('click') ?? []) {
      listener({ stopPropagation: jest.fn() });
    }
  }

  addClass(name: string): void {
    this.classes.add(name);
  }

  removeClass(name: string): void {
    this.classes.delete(name);
  }

  toggleClass(name: string, enabled: boolean): void {
    if (enabled) {
      this.addClass(name);
    } else {
      this.removeClass(name);
    }
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
    if (this.hasClass(className)) return this;
    for (const child of this.children) {
      const result = child.findByClass(className);
      if (result) return result;
    }
    return undefined;
  }

  closestByClass(className: string): FakeElement | undefined {
    let current: FakeElement | null = this;
    while (current) {
      if (current.hasClass(className)) {
        return current;
      }
      current = current.parent;
    }
    return undefined;
  }

  private appendChild(options?: { cls?: string; text?: string }): FakeElement {
    const child = new FakeElement(options?.cls);
    child.parent = this;
    child.ownerDocument = this.ownerDocument;
    child.text = options?.text ?? '';
    this.children.push(child);
    return child;
  }
}

describe('renderAddProviderPicker', () => {
  it('still offers local/custom add controls when all cloud providers are listed', () => {
    const container = new FakeElement();

    renderAddProviderPicker(
      container as unknown as HTMLElement,
      {
        plugin: {
          saveSettings: jest.fn(),
          settings: {},
          getUiFacades: () => ({ syncCustomProviders: jest.fn() }),
        },
        redisplay: jest.fn(),
      } as any,
      {
        piSettings: {
          addedProviders: ['anthropic', 'deepseek', 'google', 'openai-codex', 'opencode-go', 'openrouter'],
          customProviders: [],
        },
        updatePiSettings: jest.fn(),
      } as any,
      [],
      (id) => id,
    );

    expect(container.findByClass('pivi-provider-add-controls')).toBeDefined();
    expect(container.findByText('+ Add provider')).toBeDefined();
  });

  it('shows provider choices only after clicking add and adds the selected provider', () => {
    const container = new FakeElement();
    const saveSettings = jest.fn().mockResolvedValue(undefined);
    const redisplay = jest.fn();
    const updatePiSettings = jest.fn();
    const state = {
      piSettings: { addedProviders: ['deepseek'], customProviders: [] },
      updatePiSettings,
    };

    renderAddProviderPicker(
      container as unknown as HTMLElement,
      {
        plugin: {
          saveSettings,
          settings: {},
          getUiFacades: () => ({ syncCustomProviders: jest.fn() }),
        },
        redisplay,
      } as any,
      state as any,
      ['opencode-go'],
      (id) => id,
    );

    const addButton = container.findByText('+ Add provider');
    const option = container.findByText('opencode-go')?.closestByClass('pivi-provider-add-option');
    const dropdown = container.findByClass('pivi-provider-add-dropdown');

    expect(addButton).toBeDefined();
    expect(option).toBeDefined();
    expect(dropdown?.hasClass('is-visible')).toBe(false);

    addButton?.click();
    expect(dropdown?.hasClass('is-visible')).toBe(true);

    option?.click();

    expect(updatePiSettings).toHaveBeenCalledWith({ addedProviders: ['deepseek', 'opencode-go'] });
    expect(saveSettings).toHaveBeenCalled();
  });
});

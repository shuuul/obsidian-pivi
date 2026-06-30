import { renderAddProviderPicker } from '../../../../src/pi/ui/models-settings/modelPicker';

jest.mock('../../../../src/pi/ui/providerLogos', () => ({
  getProviderLogoSlug: () => null,
}));

class FakeElement {
  children: FakeElement[] = [];
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

  private appendChild(options?: { cls?: string; text?: string }): FakeElement {
    const child = new FakeElement(options?.cls);
    child.ownerDocument = this.ownerDocument;
    child.text = options?.text ?? '';
    this.children.push(child);
    return child;
  }
}

describe('renderAddProviderPicker', () => {
  it('does not render add controls when every provider is already listed', () => {
    const container = new FakeElement();

    renderAddProviderPicker(
      container as unknown as HTMLElement,
      { plugin: { saveSettings: jest.fn() }, redisplay: jest.fn() } as any,
      {
        piSettings: { addedProviders: ['anthropic', 'deepseek', 'google', 'openai-codex', 'opencode-go', 'openrouter'] },
        updatePiSettings: jest.fn(),
      } as any,
      [],
      (id) => id,
    );

    expect(container.findByClass('pivi-provider-add-controls')).toBeUndefined();
    expect(container.findByText('All providers added')).toBeUndefined();
  });

  it('shows provider choices only after clicking add and adds the selected provider', () => {
    const container = new FakeElement();
    const saveSettings = jest.fn().mockResolvedValue(undefined);
    const redisplay = jest.fn();
    const updatePiSettings = jest.fn();
    const state = {
      piSettings: { addedProviders: ['deepseek'] },
      updatePiSettings,
    };

    renderAddProviderPicker(
      container as unknown as HTMLElement,
      { plugin: { saveSettings }, redisplay } as any,
      state as any,
      ['opencode-go'],
      (id) => id,
    );

    const addButton = container.findByText('+ add provider');
    const option = container.findByClass('pivi-provider-add-option');
    const dropdown = container.findByClass('pivi-provider-add-dropdown');

    expect(addButton).toBeDefined();
    expect(dropdown?.hasClass('is-visible')).toBe(false);

    addButton?.click();
    expect(dropdown?.hasClass('is-visible')).toBe(true);

    option?.click();

    expect(updatePiSettings).toHaveBeenCalledWith({ addedProviders: ['deepseek', 'opencode-go'] });
    expect(saveSettings).toHaveBeenCalled();
  });
});

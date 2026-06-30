import {
  createSessionGreeting,
  ensureWelcomeGreeting,
  setWelcomeVisibility,
} from '../../../../src/features/chat/controllers/sessionWelcome';

class FakeElement {
  children: FakeElement[] = [];
  text = '';
  private classes = new Set<string>();

  constructor(cls = '') {
    for (const name of cls.split(/\s+/).filter(Boolean)) {
      this.classes.add(name);
    }
  }

  createDiv(options?: { cls?: string; text?: string }): FakeElement {
    const child = new FakeElement(options?.cls);
    child.text = options?.text ?? '';
    this.children.push(child);
    return child;
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

  querySelector(selector: string): FakeElement | null {
    if (!selector.startsWith('.')) return null;
    return this.findByClass(selector.slice(1)) ?? null;
  }

  findByClass(className: string): FakeElement | undefined {
    if (this.classes.has(className)) return this;
    for (const child of this.children) {
      const result = child.findByClass(className);
      if (result) return result;
    }
    return undefined;
  }
}

describe('sessionWelcome', () => {
  it('creates deterministic personalized greetings', () => {
    const greeting = createSessionGreeting({
      userName: 'Ada',
      now: new Date('2026-06-22T09:00:00'),
      random: () => 0,
    });

    expect(greeting).toBe('Happy Monday, Ada');
  });

  it('uses no-name fallbacks without dangling punctuation', () => {
    const greeting = createSessionGreeting({
      userName: '   ',
      now: new Date('2026-06-22T09:00:00'),
      random: () => 0.1,
    });

    expect(greeting).toBe('Back at it!');
  });

  it('toggles welcome visibility based on message presence', () => {
    const welcomeEl = new FakeElement('pivi-welcome pivi-hidden');

    setWelcomeVisibility(welcomeEl as unknown as HTMLElement, false);
    expect(welcomeEl.hasClass('pivi-hidden')).toBe(false);

    setWelcomeVisibility(welcomeEl as unknown as HTMLElement, true);
    expect(welcomeEl.hasClass('pivi-hidden')).toBe(true);
  });

  it('creates a welcome greeting only when missing', () => {
    const welcomeEl = new FakeElement('pivi-welcome');
    const getGreeting = jest.fn(() => 'Hello');

    ensureWelcomeGreeting(welcomeEl as unknown as HTMLElement, getGreeting);
    ensureWelcomeGreeting(welcomeEl as unknown as HTMLElement, getGreeting);

    expect(getGreeting).toHaveBeenCalledTimes(1);
    expect(welcomeEl.children).toHaveLength(1);
    expect(welcomeEl.children[0].text).toBe('Hello');
  });
});

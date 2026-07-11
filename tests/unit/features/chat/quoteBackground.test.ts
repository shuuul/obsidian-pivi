import { QuoteBackgroundController } from '@/ui/chat/controllers/quoteBackground';
import { WELCOME_QUOTES } from '@/ui/chat/controllers/welcomeQuotes';

interface FakeRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

class FakeResizeObserver {
  static instances: FakeResizeObserver[] = [];

  disconnected = false;
  observed: FakeElement[] = [];

  constructor(private readonly callback: () => void) {
    FakeResizeObserver.instances.push(this);
  }

  observe(element: FakeElement): void {
    this.observed.push(element);
  }

  disconnect(): void {
    this.disconnected = true;
  }

  trigger(): void {
    this.callback();
  }
}

class FakeWindow {
  private nextAnimationFrameId = 1;
  private animationFrames = new Map<number, FrameRequestCallback>();
  reducedMotion = false;

  ResizeObserver = FakeResizeObserver;

  setTimeout(callback: TimerHandler, delay?: number): number {
    return window.setTimeout(callback, delay);
  }

  clearTimeout(id: number): void {
    window.clearTimeout(id);
  }

  requestAnimationFrame(callback: FrameRequestCallback): number {
    const id = this.nextAnimationFrameId++;
    this.animationFrames.set(id, callback);
    return id;
  }

  cancelAnimationFrame(id: number): void {
    this.animationFrames.delete(id);
  }

  matchMedia(): MediaQueryList {
    return { matches: this.reducedMotion } as MediaQueryList;
  }

  flushAnimationFrames(): void {
    const callbacks = [...this.animationFrames.values()];
    this.animationFrames.clear();
    callbacks.forEach(callback => callback(0));
  }

  get pendingAnimationFrames(): number {
    return this.animationFrames.size;
  }
}

class FakeElement {
  children: FakeElement[] = [];
  style: Record<string, string> = {};
  attributes = new Map<string, string>();
  text = '';
  parent: FakeElement | null = null;
  ownerDocument: { defaultView: FakeWindow };
  private classes = new Set<string>();

  constructor(
    private readonly win: FakeWindow,
    cls = '',
    private readonly rect: FakeRect = { left: 0, top: 0, width: 220, height: 100 },
  ) {
    this.ownerDocument = { defaultView: win };
    cls.split(/\s+/).filter(Boolean).forEach(name => this.classes.add(name));
  }

  createDiv(options?: { cls?: string; text?: string }): FakeElement {
    return this.createChild(options);
  }

  createSpan(options?: { cls?: string; text?: string }): FakeElement {
    return this.createChild(options);
  }

  private createChild(options?: { cls?: string; text?: string }): FakeElement {
    const childRect = options?.cls?.includes('pivi-welcome-greeting')
      ? { left: 350, top: 280, width: 300, height: 140 }
      : { left: 0, top: 0, width: 220, height: 100 };
    const child = new FakeElement(this.win, options?.cls, childRect);
    child.text = options?.text ?? '';
    child.parent = this;
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

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  getBoundingClientRect(): DOMRect {
    return this.rect as DOMRect;
  }

  querySelector<T>(selector: string): T | null {
    if (!selector.startsWith('.')) return null;
    return (this.findByClass(selector.slice(1)) as T | undefined) ?? null;
  }

  findByClass(className: string): FakeElement | undefined {
    if (this.classes.has(className)) return this;
    for (const child of this.children) {
      const match = child.findByClass(className);
      if (match) return match;
    }
    return undefined;
  }

  findAllByClass(className: string): FakeElement[] {
    const matches: FakeElement[] = this.classes.has(className) ? [this] : [];
    return [...matches, ...this.children.flatMap(child => child.findAllByClass(className))];
  }

  empty(): void {
    this.children.forEach(child => {
      child.parent = null;
    });
    this.children = [];
  }

  remove(): void {
    if (!this.parent) return;
    this.parent.children = this.parent.children.filter(child => child !== this);
    this.parent = null;
  }
}

function createWelcome(reducedMotion = false): { welcome: FakeElement; win: FakeWindow } {
  const win = new FakeWindow();
  win.reducedMotion = reducedMotion;
  const welcome = new FakeElement(win, 'pivi-welcome', {
    left: 0,
    top: 0,
    width: 1000,
    height: 700,
  });
  welcome.createDiv({ cls: 'pivi-welcome-greeting', text: 'Welcome' });
  return { welcome, win };
}

function getRenderedQuoteText(card: FakeElement): string {
  return card
    .findAllByClass('pivi-welcome-quote-char')
    .map(character => character.text)
    .join('');
}

describe('QuoteBackgroundController', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    FakeResizeObserver.instances = [];
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('renders five differently sized fixed character trees with starts spread over one quote duration', () => {
    const { welcome, win } = createWelcome();
    const controller = new QuoteBackgroundController(
      welcome as unknown as HTMLElement,
      () => 0,
    );

    controller.start();
    const layer = welcome.findByClass('pivi-welcome-quote-layer')!;
    expect(layer.attributes.get('aria-hidden')).toBe('true');
    expect(layer.findAllByClass('pivi-welcome-quote')).toHaveLength(5);

    win.flushAnimationFrames();
    const cards = layer.findAllByClass('pivi-welcome-quote');
    const characterSets = cards.map(card => card.findAllByClass('pivi-welcome-quote-char'));
    const firstCharacters = characterSets.map(characters => characters[0]);
    const characterCounts = characterSets.map(characters => characters.length);
    const startTickInterval = Math.ceil(Math.max(...characterCounts) / 5);
    const startIntervalMs = startTickInterval * 120;

    expect([...new Set(cards.map(card => card.style.width))]).toHaveLength(5);
    expect(characterSets[0][0].hasClass('pivi-quote-char-visible')).toBe(true);
    characterSets.slice(1).forEach(characters => {
      expect(characters[0].hasClass('pivi-quote-char-visible')).toBe(false);
    });

    jest.advanceTimersByTime(startIntervalMs - 1);
    characterSets.slice(1).forEach(characters => {
      expect(characters[0].hasClass('pivi-quote-char-visible')).toBe(false);
    });

    jest.advanceTimersByTime(1);
    expect(characterSets[1][0].hasClass('pivi-quote-char-visible')).toBe(true);
    characterSets.slice(2).forEach(characters => {
      expect(characters[0].hasClass('pivi-quote-char-visible')).toBe(false);
    });

    jest.advanceTimersByTime(startIntervalMs * 3);
    expect(characterSets[4][0].hasClass('pivi-quote-char-visible')).toBe(true);
    const revealProgress = characterSets.map(
      characters =>
        characters.filter(character => character.hasClass('pivi-quote-char-visible')).length,
    );
    expect([...new Set(revealProgress)]).toHaveLength(5);
    expect(cards.map(card => card.findAllByClass('pivi-welcome-quote-char').length)).toEqual(
      characterCounts,
    );
    expect(cards.map(card => card.findAllByClass('pivi-welcome-quote-char')[0])).toEqual(
      firstCharacters,
    );

    const finalRevealAt = Math.max(
      ...characterCounts.map((count, index) => (count - 1 + index * startTickInterval) * 120),
    );
    jest.advanceTimersByTime(finalRevealAt - startIntervalMs * 4);
    cards.forEach(card => {
      expect(card.findByClass('pivi-welcome-quote-author')?.hasClass('pivi-quote-author-visible')).toBe(
        true,
      );
    });

    jest.advanceTimersByTime(3500);
    cards.forEach(card => expect(card.hasClass('pivi-quote-visible')).toBe(false));
    jest.advanceTimersByTime(1500);
    const nextCards = layer.findAllByClass('pivi-welcome-quote');
    expect(nextCards).toHaveLength(5);
    expect(nextCards[0]).not.toBe(cards[0]);

    controller.stop();
    expect(welcome.findByClass('pivi-welcome-quote-layer')).toBeUndefined();
    expect(FakeResizeObserver.instances[0].disconnected).toBe(true);
    expect(win.pendingAnimationFrames).toBe(0);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('reveals complete batches immediately with reduced motion', () => {
    const { welcome, win } = createWelcome(true);
    const controller = new QuoteBackgroundController(
      welcome as unknown as HTMLElement,
      () => 0,
    );

    controller.start();
    win.flushAnimationFrames();
    const layer = welcome.findByClass('pivi-welcome-quote-layer')!;
    const cards = layer.findAllByClass('pivi-welcome-quote');

    expect(cards).toHaveLength(5);
    cards.forEach(card => {
      expect(
        card
          .findAllByClass('pivi-welcome-quote-char')
          .every(character => character.hasClass('pivi-quote-char-visible')),
      ).toBe(true);
      expect(card.findByClass('pivi-welcome-quote-author')?.hasClass('pivi-quote-author-visible')).toBe(
        true,
      );
    });
    expect(jest.getTimerCount()).toBe(1);

    controller.stop();
    expect(jest.getTimerCount()).toBe(0);
  });

  it('rotates every quote before reusing one', () => {
    const { welcome, win } = createWelcome(true);
    const controller = new QuoteBackgroundController(
      welcome as unknown as HTMLElement,
      () => 0,
    );
    const renderedQuotes = new Set<string>();

    controller.start();
    for (let batch = 0; batch < Math.ceil(WELCOME_QUOTES.length / 5); batch++) {
      win.flushAnimationFrames();
      const layer = welcome.findByClass('pivi-welcome-quote-layer')!;
      layer
        .findAllByClass('pivi-welcome-quote')
        .forEach(card => renderedQuotes.add(getRenderedQuoteText(card)));
      jest.advanceTimersByTime(5000);
    }

    expect(renderedQuotes.size).toBe(WELCOME_QUOTES.length);
    controller.stop();
  });
});

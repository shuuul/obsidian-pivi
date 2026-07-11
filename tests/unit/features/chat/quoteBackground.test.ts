import { QuoteBackgroundController } from '@/ui/chat/controllers/quoteBackground';

function expectDefined<T>(value: T | undefined): asserts value is T {
  expect(value).toBeDefined();
}

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

function getPlacedQuoteRect(card: FakeElement): FakeRect {
  const left = card.style.left;
  const top = card.style.top;
  expectDefined(left);
  expectDefined(top);
  return {
    left: Number.parseFloat(left),
    top: Number.parseFloat(top),
    width: 220,
    height: 100,
  };
}

function overlapArea(first: FakeRect, second: FakeRect): number {
  const width = Math.max(
    0,
    Math.min(first.left + first.width, second.left + second.width) - Math.max(first.left, second.left),
  );
  const height = Math.max(
    0,
    Math.min(first.top + first.height, second.top + second.height) - Math.max(first.top, second.top),
  );
  return width * height;
}

function expand(rect: FakeRect, amount: number): FakeRect {
  return {
    left: rect.left - amount,
    top: rect.top - amount,
    width: rect.width + amount * 2,
    height: rect.height + amount * 2,
  };
}

describe('QuoteBackgroundController', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    FakeResizeObserver.instances = [];
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('waits for the finished card to fade before showing a replacement', () => {
    const { welcome, win } = createWelcome();
    const controller = new QuoteBackgroundController(
      welcome as unknown as HTMLElement,
      () => 0,
    );

    controller.start();
    const layer = welcome.findByClass('pivi-welcome-quote-layer')!;
    expect(layer.attributes.get('aria-hidden')).toBe('true');
    win.flushAnimationFrames();

    const cards = layer.findAllByClass('pivi-welcome-quote');
    const characterSets = cards.map(card => card.findAllByClass('pivi-welcome-quote-char'));
    const characterCounts = characterSets.map(characters => characters.length);
    const startTickInterval = Math.ceil(Math.max(...characterCounts) / 5);
    const startIntervalMs = startTickInterval * 120;
    const finishTimes = characterCounts.map(
      (count, index) => (count - 1) * 120 + index * startIntervalMs,
    );
    const firstFinishedIndex = finishTimes.indexOf(Math.min(...finishTimes));
    const initialQuoteTexts = new Set(cards.map(getRenderedQuoteText));

    expect(cards).toHaveLength(5);
    expect([...new Set(cards.map(card => card.style.width))]).toHaveLength(5);
    const firstCharacterSet = characterSets[0];
    expectDefined(firstCharacterSet);
    const firstCharacter = firstCharacterSet[0];
    expectDefined(firstCharacter);
    expect(firstCharacter.hasClass('pivi-quote-char-visible')).toBe(true);
    characterSets.slice(1).forEach(characters => {
      const firstCharacter = characters[0];
      expectDefined(firstCharacter);
      expect(firstCharacter.hasClass('pivi-quote-char-visible')).toBe(false);
    });

    const firstFinishedTime = finishTimes[firstFinishedIndex];
    expectDefined(firstFinishedTime);
    const finishedCard = cards[firstFinishedIndex];
    expectDefined(finishedCard);
    jest.advanceTimersByTime(firstFinishedTime + 3500);
    expect(finishedCard.hasClass('pivi-quote-visible')).toBe(false);
    expect(
      cards.some(
        (card, index) =>
          index !== firstFinishedIndex &&
          !card.findByClass('pivi-welcome-quote-author')?.hasClass('pivi-quote-author-visible'),
      ),
    ).toBe(true);

    win.flushAnimationFrames();
    const cardsDuringFade = layer.findAllByClass('pivi-welcome-quote');
    expect(cardsDuringFade).toHaveLength(5);
    expect(cardsDuringFade).toEqual(cards);

    jest.advanceTimersByTime(1500);
    expect(layer.findAllByClass('pivi-welcome-quote')).not.toContain(finishedCard);

    win.flushAnimationFrames();
    const cardsAfterFade = layer.findAllByClass('pivi-welcome-quote');
    const replacementCards = cardsAfterFade.filter(card => !cards.includes(card));
    expect(cardsAfterFade).toHaveLength(5);
    expect(replacementCards).toHaveLength(1);
    const replacementCard = replacementCards[0];
    expectDefined(replacementCard);
    expect(initialQuoteTexts.has(getRenderedQuoteText(replacementCard))).toBe(false);
    const replacementCharacter = replacementCard.findAllByClass('pivi-welcome-quote-char')[0];
    expectDefined(replacementCharacter);
    expect(replacementCharacter.hasClass('pivi-quote-char-visible')).toBe(true);
    const replacementRect = getPlacedQuoteRect(replacementCard);
    cardsAfterFade
      .filter(card => card !== replacementCard)
      .forEach(card => {
        expect(overlapArea(replacementRect, expand(getPlacedQuoteRect(card), 16))).toBe(0);
      });

    controller.stop();
    expect(welcome.findByClass('pivi-welcome-quote-layer')).toBeUndefined();
    expectDefined(FakeResizeObserver.instances[0]);
    expect(FakeResizeObserver.instances[0].disconnected).toBe(true);
    expect(win.pendingAnimationFrames).toBe(0);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('shows every card immediately when reduced motion is enabled', () => {
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
    expect(jest.getTimerCount()).toBe(5);

    controller.stop();
    expect(jest.getTimerCount()).toBe(0);
  });
});

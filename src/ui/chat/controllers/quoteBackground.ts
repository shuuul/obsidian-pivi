import { getActiveWindow } from '@/ui/shared/dom';

import {
  computeQuotePlacements,
  type QuoteRect,
  type QuoteSize,
} from './quotePlacement';
import { WELCOME_QUOTES, type WelcomeQuote } from './welcomeQuotes';

const REVEAL_INTERVAL_MS = 120;
const VISIBLE_QUOTE_COUNT = 5;
const MIN_CARD_WIDTH_PERCENT = 24;
const MAX_CARD_WIDTH_PERCENT = 42;
const HOLD_MS = 3500;
const FADE_MS = 1500;

interface RenderedQuote {
  quote: WelcomeQuote;
  cardEl: HTMLElement;
  characters: HTMLElement[];
  authorEl: HTMLElement;
  placement: QuoteRect | null;
  startDelayMs: number;
  started: boolean;
  retiring: boolean;
}

function shuffled<T>(items: readonly T[], random: () => number): T[] {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index--) {
    const swapIndex = Math.floor(random() * (index + 1));
    [copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]];
  }
  return copy;
}

function appendCharacters(parent: HTMLElement, text: string, characters: HTMLElement[]): void {
  for (const character of Array.from(text)) {
    const characterEl = parent.createSpan({
      cls: 'pivi-welcome-quote-char',
      text: character,
    });
    characters.push(characterEl);
  }
}

function renderQuote(
  layerEl: HTMLElement,
  quote: WelcomeQuote,
  widthPercent: number,
): RenderedQuote {
  const cardEl = layerEl.createDiv({ cls: 'pivi-welcome-quote' });
  cardEl.style.width = `clamp(132px, ${widthPercent}%, 300px)`;
  const textEl = cardEl.createDiv({ cls: 'pivi-welcome-quote-text' });
  const characters: HTMLElement[] = [];

  for (const segment of quote.text.split(/(\s+)/).filter(Boolean)) {
    if (/^\s+$/.test(segment)) {
      appendCharacters(textEl, segment, characters);
      continue;
    }
    const wordEl = textEl.createSpan({ cls: 'pivi-welcome-quote-word' });
    appendCharacters(wordEl, segment, characters);
  }

  const authorEl = cardEl.createDiv({
    cls: 'pivi-welcome-quote-author',
    text: `— ${quote.author}`,
  });
  return {
    quote,
    cardEl,
    characters,
    authorEl,
    placement: null,
    startDelayMs: 0,
    started: false,
    retiring: false,
  };
}

interface WindowWithResizeObserver extends Window {
  ResizeObserver: typeof ResizeObserver;
}

export class QuoteBackgroundController {
  private layerEl: HTMLElement | null = null;
  private renderedQuotes: RenderedQuote[] = [];
  private queue: WelcomeQuote[] = [];
  private timerIds = new Set<number>();
  private animationFrameId: number | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private running = false;
  private needsFullPlacement = false;

  constructor(
    private readonly welcomeEl: HTMLElement,
    private readonly random: () => number = Math.random,
  ) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.layerEl = this.welcomeEl.createDiv({ cls: 'pivi-welcome-quote-layer' });
    this.layerEl.setAttribute('aria-hidden', 'true');

    const win = getActiveWindow(this.layerEl) as WindowWithResizeObserver;
    const observer = new win.ResizeObserver(() => this.schedulePlacement(true));
    observer.observe(this.welcomeEl);
    this.resizeObserver = observer;
    this.renderInitialQuotes();
  }

  stop(): void {
    this.running = false;
    this.clearTimers();
    this.clearAnimationFrame();
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.layerEl?.remove();
    this.layerEl = null;
    this.renderedQuotes = [];
    this.needsFullPlacement = false;
  }

  private renderInitialQuotes(): void {
    const quotes = Array.from({ length: VISIBLE_QUOTE_COUNT }, (_, index) =>
      this.createQuote(index),
    );
    const startTickInterval = Math.ceil(
      Math.max(...quotes.map(quote => quote.characters.length)) / VISIBLE_QUOTE_COUNT,
    );
    quotes.forEach((quote, index) => {
      quote.startDelayMs = index * startTickInterval * REVEAL_INTERVAL_MS;
    });
    this.schedulePlacement();
  }

  private createQuote(index: number): RenderedQuote {
    if (!this.layerEl) throw new Error('Quote layer is unavailable');
    const quote = renderQuote(
      this.layerEl,
      this.takeNextQuote(),
      this.getCardWidthPercent(index % VISIBLE_QUOTE_COUNT),
    );
    this.renderedQuotes.push(quote);
    return quote;
  }

  private getCardWidthPercent(index: number): number {
    const widthRange = MAX_CARD_WIDTH_PERCENT - MIN_CARD_WIDTH_PERCENT;
    return MIN_CARD_WIDTH_PERCENT + ((index + this.random()) / VISIBLE_QUOTE_COUNT) * widthRange;
  }

  private takeNextQuote(): WelcomeQuote {
    if (this.queue.length === 0) {
      const activeQuotes = new Set(this.renderedQuotes.map(quote => quote.quote));
      const availableQuotes = WELCOME_QUOTES.filter(quote => !activeQuotes.has(quote));
      this.queue.push(...shuffled(availableQuotes.length > 0 ? availableQuotes : WELCOME_QUOTES, this.random));
    }
    return this.queue.shift()!;
  }

  private schedulePlacement(reposition = false): void {
    if (!this.running || !this.layerEl) return;
    this.needsFullPlacement ||= reposition;
    if (this.animationFrameId !== null) return;

    const win = getActiveWindow(this.layerEl);
    this.animationFrameId = win.requestAnimationFrame(() => {
      this.animationFrameId = null;
      const needsFullPlacement = this.needsFullPlacement;
      this.needsFullPlacement = false;
      if (needsFullPlacement) {
        this.placeAllQuotes();
      } else {
        this.placeUnplacedQuotes();
      }
    });
  }

  private getPlacementContext(): {
    container: QuoteSize;
    blocked: QuoteRect | null;
  } | null {
    const containerRect = this.welcomeEl.getBoundingClientRect();
    if (containerRect.width <= 0 || containerRect.height <= 0) return null;

    const greetingRect = this.welcomeEl
      .querySelector<HTMLElement>('.pivi-welcome-greeting')
      ?.getBoundingClientRect();
    return {
      container: { width: containerRect.width, height: containerRect.height },
      blocked: greetingRect
        ? {
            left: greetingRect.left - containerRect.left,
            top: greetingRect.top - containerRect.top,
            width: greetingRect.width,
            height: greetingRect.height,
          }
        : null,
    };
  }

  private placeUnplacedQuotes(): void {
    const context = this.getPlacementContext();
    if (!context) return;

    for (const quote of this.renderedQuotes) {
      if (quote.placement) continue;
      const rect = quote.cardEl.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      const size = { width: rect.width, height: rect.height };
      const [point] = computeQuotePlacements({
        ...context,
        cards: [size],
        occupied: this.getOccupiedRects(quote),
        random: this.random,
      });
      this.applyPlacement(quote, point, size);
      this.startQuote(quote);
    }
  }

  private placeAllQuotes(): void {
    const context = this.getPlacementContext();
    if (!context || this.renderedQuotes.length === 0) return;

    const sizes = this.renderedQuotes.map(quote => {
      const rect = quote.cardEl.getBoundingClientRect();
      return { width: rect.width, height: rect.height };
    });
    if (sizes.some(size => size.width <= 0 || size.height <= 0)) return;

    const placements = computeQuotePlacements({
      ...context,
      cards: sizes,
      random: this.random,
    });
    this.renderedQuotes.forEach((quote, index) => {
      this.applyPlacement(quote, placements[index], sizes[index]);
      this.startQuote(quote);
    });
  }

  private getOccupiedRects(excludedQuote: RenderedQuote): QuoteRect[] {
    return this.renderedQuotes.flatMap(quote =>
      quote === excludedQuote || !quote.placement ? [] : [quote.placement],
    );
  }

  private applyPlacement(quote: RenderedQuote, point: { left: number; top: number }, size: QuoteSize): void {
    quote.placement = { ...point, ...size };
    quote.cardEl.style.left = `${point.left}px`;
    quote.cardEl.style.top = `${point.top}px`;
  }

  private startQuote(quote: RenderedQuote): void {
    if (quote.started || quote.retiring) return;
    quote.started = true;
    const reducedMotion =
      getActiveWindow(this.layerEl).matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    const reveal = () => this.revealQuote(quote);
    if (quote.startDelayMs > 0 && !reducedMotion) {
      this.schedule(reveal, quote.startDelayMs);
    } else {
      reveal();
    }
  }

  private revealQuote(quote: RenderedQuote): void {
    if (!this.running || quote.retiring) return;
    quote.cardEl.addClass('pivi-quote-visible');
    const win = getActiveWindow(this.layerEl);
    const reducedMotion = win.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    if (reducedMotion) {
      quote.characters.forEach(character => character.addClass('pivi-quote-char-visible'));
      quote.authorEl.addClass('pivi-quote-author-visible');
      this.finishQuote(quote);
      return;
    }
    this.revealCharacter(quote, 0);
  }

  private revealCharacter(quote: RenderedQuote, characterIndex: number): void {
    if (!this.running || quote.retiring) return;
    quote.characters[characterIndex]?.addClass('pivi-quote-char-visible');
    if (characterIndex === quote.characters.length - 1) {
      quote.authorEl.addClass('pivi-quote-author-visible');
      this.finishQuote(quote);
      return;
    }
    this.schedule(() => this.revealCharacter(quote, characterIndex + 1), REVEAL_INTERVAL_MS);
  }

  private finishQuote(quote: RenderedQuote): void {
    this.schedule(() => this.retireQuote(quote), HOLD_MS);
  }

  private retireQuote(quote: RenderedQuote): void {
    if (!this.running || quote.retiring) return;
    quote.retiring = true;
    quote.cardEl.removeClass('pivi-quote-visible');
    this.createQuote(this.renderedQuotes.filter(rendered => !rendered.retiring).length);
    this.schedulePlacement();
    this.schedule(() => {
      quote.cardEl.remove();
      this.renderedQuotes = this.renderedQuotes.filter(rendered => rendered !== quote);
    }, FADE_MS);
  }

  private schedule(callback: () => void, delay: number): void {
    const win = getActiveWindow(this.layerEl);
    let timerId = 0;
    timerId = win.setTimeout(() => {
      this.timerIds.delete(timerId);
      callback();
    }, delay);
    this.timerIds.add(timerId);
  }

  private clearTimers(): void {
    const win = getActiveWindow(this.layerEl);
    this.timerIds.forEach(timerId => win.clearTimeout(timerId));
    this.timerIds.clear();
  }

  private clearAnimationFrame(): void {
    if (this.animationFrameId === null) return;
    getActiveWindow(this.layerEl).cancelAnimationFrame(this.animationFrameId);
    this.animationFrameId = null;
  }
}

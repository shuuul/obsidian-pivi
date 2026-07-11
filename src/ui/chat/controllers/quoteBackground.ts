import { getActiveWindow } from '@/ui/shared/dom';

import { computeQuotePlacements } from './quotePlacement';
import { WELCOME_QUOTES, type WelcomeQuote } from './welcomeQuotes';

const REVEAL_INTERVAL_MS = 120;
const VISIBLE_QUOTE_COUNT = 5;
const MIN_CARD_WIDTH_PERCENT = 24;
const MAX_CARD_WIDTH_PERCENT = 42;
const HOLD_MS = 3500;
const FADE_MS = 1500;


interface RenderedQuote {
  cardEl: HTMLElement;
  characters: HTMLElement[];
  authorEl: HTMLElement;
  startTick: number;
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
  return { cardEl, characters, authorEl, startTick: 0 };
}

interface WindowWithResizeObserver extends Window {
  ResizeObserver: typeof ResizeObserver;
}

export class QuoteBackgroundController {
  private layerEl: HTMLElement | null = null;
  private renderedQuotes: RenderedQuote[] = [];
  private queue: WelcomeQuote[] = [];
  private revealIndex = 0;
  private timerId: number | null = null;
  private animationFrameId: number | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private running = false;
  private revealStarted = false;

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
    const observer = new win.ResizeObserver(() => this.schedulePlacement());
    observer.observe(this.welcomeEl);
    this.resizeObserver = observer;
    this.renderNextBatch();
  }

  stop(): void {
    this.running = false;
    this.clearTimer();
    this.clearAnimationFrame();
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.layerEl?.remove();
    this.layerEl = null;
    this.renderedQuotes = [];
    this.revealStarted = false;
  }

  private renderNextBatch(): void {
    if (!this.layerEl) return;
    this.layerEl.empty();
    const quotes = this.takeNextQuotes();
    this.renderedQuotes = quotes.map((quote, index) =>
      renderQuote(this.layerEl!, quote, this.getCardWidthPercent(index)),
    );
    const startTickInterval = Math.ceil(
      Math.max(...this.renderedQuotes.map(quote => quote.characters.length)) / VISIBLE_QUOTE_COUNT,
    );
    this.renderedQuotes.forEach((quote, index) => {
      quote.startTick = index * startTickInterval;
    });
    this.revealIndex = 0;
    this.revealStarted = false;
    this.schedulePlacement();
  }
  private getCardWidthPercent(index: number): number {
    const widthRange = MAX_CARD_WIDTH_PERCENT - MIN_CARD_WIDTH_PERCENT;
    return MIN_CARD_WIDTH_PERCENT + ((index + this.random()) / VISIBLE_QUOTE_COUNT) * widthRange;
  }


  private takeNextQuotes(): WelcomeQuote[] {
    if (this.queue.length < VISIBLE_QUOTE_COUNT) {
      const queuedQuotes = new Set(this.queue);
      this.queue.push(
        ...shuffled(WELCOME_QUOTES, this.random).filter(quote => !queuedQuotes.has(quote)),
      );
    }
    return this.queue.splice(0, VISIBLE_QUOTE_COUNT);
  }

  private schedulePlacement(): void {
    if (!this.running || this.animationFrameId !== null) return;
    const win = getActiveWindow(this.layerEl);
    this.animationFrameId = win.requestAnimationFrame(() => {
      this.animationFrameId = null;
      this.placeCurrentBatch();
    });
  }

  private placeCurrentBatch(): void {
    if (!this.running || !this.layerEl || this.renderedQuotes.length === 0) return;

    const containerRect = this.welcomeEl.getBoundingClientRect();
    const cardRects = this.renderedQuotes.map(quote => quote.cardEl.getBoundingClientRect());
    if (
      containerRect.width <= 0 ||
      containerRect.height <= 0 ||
      cardRects.some(rect => rect.width <= 0 || rect.height <= 0)
    ) {
      return;
    }

    const greetingRect = this.welcomeEl
      .querySelector<HTMLElement>('.pivi-welcome-greeting')
      ?.getBoundingClientRect();
    const blocked = greetingRect
      ? {
          left: greetingRect.left - containerRect.left,
          top: greetingRect.top - containerRect.top,
          width: greetingRect.width,
          height: greetingRect.height,
        }
      : null;
    const placements = computeQuotePlacements({
      container: { width: containerRect.width, height: containerRect.height },
      blocked,
      cards: cardRects.map(rect => ({ width: rect.width, height: rect.height })),
      random: this.random,
    });

    this.renderedQuotes.forEach((quote, index) => {
      quote.cardEl.style.left = `${placements[index].left}px`;
      quote.cardEl.style.top = `${placements[index].top}px`;
    });

    if (!this.revealStarted) this.startReveal();
  }

  private startReveal(): void {
    if (!this.running) return;
    this.revealStarted = true;
    const win = getActiveWindow(this.layerEl);
    const reducedMotion = win.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

    this.renderedQuotes.forEach(quote => quote.cardEl.addClass('pivi-quote-visible'));
    if (reducedMotion) {
      this.renderedQuotes.forEach(quote => {
        quote.characters.forEach(character => character.addClass('pivi-quote-char-visible'));
        quote.authorEl.addClass('pivi-quote-author-visible');
      });
      this.timerId = win.setTimeout(() => this.fadeCurrentBatch(), HOLD_MS);
      return;
    }

    this.revealCharactersAt(0);
    if (this.isRevealComplete()) {
      this.finishReveal();
      return;
    }
    this.timerId = win.setTimeout(() => this.advanceReveal(), REVEAL_INTERVAL_MS);
  }

  private advanceReveal(): void {
    if (!this.running) return;
    this.revealIndex++;
    this.revealCharactersAt(this.revealIndex);
    if (this.isRevealComplete()) {
      this.finishReveal();
      return;
    }
    const win = getActiveWindow(this.layerEl);
    this.timerId = win.setTimeout(() => this.advanceReveal(), REVEAL_INTERVAL_MS);
  }

  private revealCharactersAt(tick: number): void {
    this.renderedQuotes.forEach(quote => {
      const characterIndex = tick - quote.startTick;
      if (characterIndex < 0) return;
      quote.characters[characterIndex]?.addClass('pivi-quote-char-visible');
      if (characterIndex === quote.characters.length - 1) {
        quote.authorEl.addClass('pivi-quote-author-visible');
      }
    });
  }

  private isRevealComplete(): boolean {
    return this.renderedQuotes.every(
      quote => this.revealIndex >= quote.startTick + quote.characters.length - 1,
    );
  }

  private finishReveal(): void {
    const win = getActiveWindow(this.layerEl);
    this.timerId = win.setTimeout(() => this.fadeCurrentBatch(), HOLD_MS);
  }

  private fadeCurrentBatch(): void {
    if (!this.running) return;
    this.renderedQuotes.forEach(quote => quote.cardEl.removeClass('pivi-quote-visible'));
    const win = getActiveWindow(this.layerEl);
    this.timerId = win.setTimeout(() => this.renderNextBatch(), FADE_MS);
  }

  private clearTimer(): void {
    if (this.timerId === null) return;
    getActiveWindow(this.layerEl).clearTimeout(this.timerId);
    this.timerId = null;
  }

  private clearAnimationFrame(): void {
    if (this.animationFrameId === null) return;
    getActiveWindow(this.layerEl).cancelAnimationFrame(this.animationFrameId);
    this.animationFrameId = null;
  }
}

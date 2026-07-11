import type { AskUserQuestionItem, AskUserQuestionOption } from '@pivi/pivi-agent-core/foundation/tools';

import { createInlineAskKeyDownHandler } from './inlineAskUserQuestionKeys';
import {
  parseQuestionsFromInput,
  renderTabBar,
  renderTabContent,
  updateOptionVisuals,
  updateTabIndicators,
} from './inlineAskUserQuestionRender';
import type { InlineAskQuestionConfig } from './inlineAskUserQuestionTypes';

export type { InlineAskQuestionConfig } from './inlineAskUserQuestionTypes';

export class InlineAskUserQuestion {
  private containerEl: HTMLElement;
  private input: Record<string, unknown>;
  private resolveCallback: (result: Record<string, string | string[]> | null) => void;
  private resolved = false;
  private signal?: AbortSignal;
  config: Required<Omit<InlineAskQuestionConfig, 'headerEl'>> & { headerEl?: HTMLElement };

  questions: AskUserQuestionItem[] = [];
  answers = new Map<number, Set<string>>();
  customInputs = new Map<number, string>();

  activeTabIndex = 0;
  focusedItemIndex = 0;
  isInputFocused = false;

  rootEl!: HTMLElement;
  tabBar!: HTMLElement;
  contentArea!: HTMLElement;
  tabElements: HTMLElement[] = [];
  currentItems: HTMLElement[] = [];
  private boundKeyDown: (e: KeyboardEvent) => void;
  private abortHandler: (() => void) | null = null;

  constructor(
    containerEl: HTMLElement,
    input: Record<string, unknown>,
    resolve: (result: Record<string, string | string[]> | null) => void,
    signal?: AbortSignal,
    config?: InlineAskQuestionConfig,
  ) {
    this.containerEl = containerEl;
    this.input = input;
    this.resolveCallback = resolve;
    this.signal = signal;
    this.config = {
      title: config?.title ?? 'Question',
      headerEl: config?.headerEl,
      showCustomInput: config?.showCustomInput ?? true,
      immediateSelect: config?.immediateSelect ?? false,
    };
    this.boundKeyDown = createInlineAskKeyDownHandler(this);
  }

  render(): void {
    this.rootEl = this.containerEl.createDiv({ cls: 'pivi-ask-question-inline' });

    const titleEl = this.rootEl.createDiv({ cls: 'pivi-ask-inline-title' });
    titleEl.setText(this.config.title);

    if (this.config.headerEl) {
      this.rootEl.appendChild(this.config.headerEl);
    }

    this.questions = parseQuestionsFromInput(this.input);

    if (this.questions.length === 0) {
      this.handleResolve(null);
      return;
    }

    if (this.config.immediateSelect && this.questions.length !== 1) {
      this.config.immediateSelect = false;
    }

    for (let i = 0; i < this.questions.length; i++) {
      this.answers.set(i, new Set());
      this.customInputs.set(i, '');
    }

    if (!this.config.immediateSelect) {
      this.tabBar = this.rootEl.createDiv({ cls: 'pivi-ask-tab-bar' });
      renderTabBar(this);
    }
    this.contentArea = this.rootEl.createDiv({ cls: 'pivi-ask-content' });
    renderTabContent(this);

    this.rootEl.setAttribute('tabindex', '0');
    this.rootEl.addEventListener('keydown', this.boundKeyDown);

    window.requestAnimationFrame(() => {
      this.rootEl.focus();
      this.rootEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    });

    if (this.signal) {
      this.abortHandler = () => this.handleResolve(null);
      this.signal.addEventListener('abort', this.abortHandler, { once: true });
    }
  }

  destroy(): void {
    this.handleResolve(null);
  }

  isQuestionAnswered(idx: number): boolean {
    return (this.answers.get(idx)?.size ?? 0) > 0
      || (this.customInputs.get(idx)?.trim().length ?? 0) > 0;
  }

  switchTab(index: number): void {
    const clamped = Math.max(0, Math.min(index, this.questions.length - 1));
    this.activeTabIndex = clamped;
    this.focusedItemIndex = 0;
    this.isInputFocused = false;
    if (!this.config.immediateSelect) {
      renderTabBar(this);
    }
    renderTabContent(this);
    this.rootEl.focus();
  }

  selectOption(qIdx: number, option: AskUserQuestionOption): void {
    const q = this.questions[qIdx];
    const selected = this.answers.get(qIdx);
    if (!q || !selected) return;
    const isMulti = q.multiSelect;
    const optionValue = this.getOptionValue(option);

    if (isMulti) {
      if (selected.has(optionValue)) {
        selected.delete(optionValue);
      } else {
        selected.add(optionValue);
      }
    } else {
      selected.clear();
      selected.add(optionValue);
      this.customInputs.set(qIdx, '');
    }

    updateOptionVisuals(this, qIdx);

    if (this.config.immediateSelect) {
      const key = q.id ?? q.question;
      const result: Record<string, string> = {};
      result[key] = optionValue;
      this.handleResolve(result);
      return;
    }

    updateTabIndicators(this);

    if (!isMulti) {
      this.switchTab(this.activeTabIndex + 1);
    }
  }

  handleSubmit(): void {
    const allAnswered = this.questions.every((_, i) => this.isQuestionAnswered(i));
    if (!allAnswered) return;

    const result: Record<string, string | string[]> = {};
    for (const [index, question] of this.questions.entries()) {
      const key = question.id ?? question.question;
      const selectedValues = [...(this.answers.get(index) ?? [])];
      const customInput = (this.customInputs.get(index) ?? '').trim();

      if (question.multiSelect) {
        const answers = [...selectedValues];
        if (customInput) {
          answers.push(customInput);
        }
        result[key] = answers;
        continue;
      }

      result[key] = customInput || selectedValues[0] || '';
    }
    this.handleResolve(result);
  }

  canShowCustomInputForQuestion(question: AskUserQuestionItem): boolean {
    return this.config.showCustomInput && question.isOther === true;
  }

  getOptionValue(option: AskUserQuestionOption): string {
    return option.value ?? option.label;
  }

  getSelectedLabels(idx: number): string[] {
    const selected = this.answers.get(idx);
    const question = this.questions[idx];
    if (!question || !selected) return [];
    return question.options
      .filter(option => selected.has(this.getOptionValue(option)))
      .map(option => option.label);
  }

  handleResolve(result: Record<string, string | string[]> | null): void {
    if (!this.resolved) {
      this.resolved = true;
      this.rootEl?.removeEventListener('keydown', this.boundKeyDown);
      if (this.signal && this.abortHandler) {
        this.signal.removeEventListener('abort', this.abortHandler);
        this.abortHandler = null;
      }
      this.rootEl?.remove();
      this.resolveCallback(result);
    }
  }
}
import type { AskUserQuestionItem, AskUserQuestionOption } from '@pivi/pivi-agent-core/foundation/tools';

import { t } from '@/i18n';

import type { InlineAskUserQuestionHost } from './inlineAskUserQuestionTypes';

export const HINTS_TEXT = 'Enter to select \u00B7 Tab/Arrow keys to navigate \u00B7 Esc to cancel';
export const HINTS_TEXT_IMMEDIATE = 'Enter to select \u00B7 Arrow keys to navigate \u00B7 Esc to cancel';

function extractLabel(obj: Record<string, unknown>): string {
  if (typeof obj.label === 'string') return obj.label;
  if (typeof obj.value === 'string') return obj.value;
  if (typeof obj.text === 'string') return obj.text;
  if (typeof obj.name === 'string') return obj.name;
  return 'Option';
}

function stringifyOptionValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return `${value}`;
  }
  return 'Option';
}

function extractValue(obj: Record<string, unknown>, fallback: string): string {
  if (typeof obj.value === 'string') return obj.value;
  if (typeof obj.id === 'string') return obj.id;
  return fallback;
}

export function coerceOption(opt: unknown): AskUserQuestionOption {
  if (typeof opt === 'object' && opt !== null) {
    const obj = opt as Record<string, unknown>;
    const label = extractLabel(obj);
    const description = typeof obj.description === 'string' ? obj.description : '';
    const value = extractValue(obj, label);
    return { label, description, ...(value !== label ? { value } : {}) };
  }
  return { label: stringifyOptionValue(opt), description: '' };
}

function deduplicateOptions(options: AskUserQuestionOption[]): AskUserQuestionOption[] {
  const seen = new Set<string>();
  return options.filter((o) => {
    if (seen.has(o.label)) return false;
    seen.add(o.label);
    return true;
  });
}

export function parseQuestionsFromInput(input: Record<string, unknown>): AskUserQuestionItem[] {
  const raw = input.questions;
  if (!Array.isArray(raw)) return [];

  return (raw as unknown[])
    .filter(
      (q): q is {
        question: string;
        header?: string;
        options?: unknown[] | null;
        multiSelect?: boolean;
        isOther?: boolean;
        isSecret?: boolean;
        id?: string;
      } => {
        if (!q || typeof q !== 'object' || Array.isArray(q)) {
          return false;
        }
        const record = q as Record<string, unknown>;
        return typeof record.question === 'string'
          && ((Array.isArray(record.options) && record.options.length > 0) || record.isOther === true);
      },
    )
    .map((q, idx) => ({
      question: q.question,
      id: typeof (q as Record<string, unknown>).id === 'string' ? (q as Record<string, unknown>).id as string : undefined,
      header: typeof q.header === 'string' ? q.header.slice(0, 12) : `Q${idx + 1}`,
      options: deduplicateOptions((q.options ?? []).map((o) => coerceOption(o))),
      multiSelect: q.multiSelect === true,
      isOther: q.isOther === true,
      isSecret: q.isSecret === true,
    }));
}

function renderMultiSelectCheckbox(parent: HTMLElement, checked: boolean): void {
  parent.createSpan({
    text: checked ? '[\u2713] ' : '[ ] ',
    cls: `pivi-ask-check${checked ? ' is-checked' : ''}`,
  });
}

export function updateFocusIndicator(host: InlineAskUserQuestionHost): void {
  for (let i = 0; i < host.currentItems.length; i++) {
    const item = host.currentItems[i];
    if (!item) continue;
    const cursor = item.querySelector('.pivi-ask-cursor');
    if (i === host.focusedItemIndex) {
      item.addClass('is-focused');
      if (cursor) cursor.textContent = '\u203A';
      item.scrollIntoView({ block: 'nearest' });
    } else {
      item.removeClass('is-focused');
      if (cursor) cursor.textContent = '\u00A0';
    }
  }
}
export function updateOptionVisuals(host: InlineAskUserQuestionHost, qIdx: number): void {
  const q = host.questions[qIdx];
  if (!q) return;
  const selected = host.answers.get(qIdx)!;
  const isMulti = q.multiSelect;

  for (let i = 0; i < q.options.length; i++) {
    const item = host.currentItems[i];
    const option = q.options[i];
    if (!item || !option) continue;
    const isSelected = selected.has(host.getOptionValue(option));

    item.toggleClass('is-selected', isSelected);

    if (isMulti) {
      const checkSpan = item.querySelector('.pivi-ask-check');
      if (checkSpan) {
        checkSpan.textContent = isSelected ? '[\u2713] ' : '[ ] ';
        checkSpan.toggleClass('is-checked', isSelected);
      }
    } else {
      const labelRow = item.querySelector('.pivi-ask-label-row');
      const existingMark = item.querySelector('.pivi-ask-check-mark');
      if (isSelected && !existingMark && labelRow) {
        labelRow.createSpan({ text: ' \u2713', cls: 'pivi-ask-check-mark' });
      } else if (!isSelected && existingMark) {
        existingMark.remove();
      }
    }
  }
}

export function updateTabIndicators(host: InlineAskUserQuestionHost): void {
  for (let idx = 0; idx < host.questions.length; idx++) {
    const tab = host.tabElements[idx];
    if (!tab) continue;
    const tick = tab.querySelector('.pivi-ask-tab-tick');
    const answered = host.isQuestionAnswered(idx);
    tab.toggleClass('is-answered', answered);
    if (tick) tick.textContent = answered ? ' \u2713' : '';
  }
  const submitTab = host.tabElements[host.questions.length];
  if (submitTab) {
    const submitCheck = submitTab.querySelector('.pivi-ask-tab-submit-check');
    const allAnswered = host.questions.every((_, i) => host.isQuestionAnswered(i));
    if (submitCheck) submitCheck.textContent = allAnswered ? '\u2713 ' : '';
  }
}

function getAnswerText(host: InlineAskUserQuestionHost, idx: number): string {
  const selected = host.getSelectedLabels(idx);
  const custom = host.customInputs.get(idx)!;
  const parts: string[] = [];
  if (selected.length > 0) parts.push(selected.join(', '));
  if (custom.trim()) parts.push(custom.trim());
  return parts.join(', ');
}

export function renderTabBar(host: InlineAskUserQuestionHost): void {
  host.tabBar.empty();
  host.tabElements = [];

  for (let idx = 0; idx < host.questions.length; idx++) {
    const answered = host.isQuestionAnswered(idx);
    const q = host.questions[idx];
    if (!q) continue;
    const tab = host.tabBar.createSpan({ cls: 'pivi-ask-tab' });
    tab.createSpan({ text: q.header, cls: 'pivi-ask-tab-label' });
    tab.createSpan({ text: answered ? ' \u2713' : '', cls: 'pivi-ask-tab-tick' });
    tab.setAttribute('title', q.question);

    if (idx === host.activeTabIndex) tab.addClass('is-active');
    if (answered) tab.addClass('is-answered');
    tab.addEventListener('click', () => host.switchTab(idx));
    host.tabElements.push(tab);
  }

  const allAnswered = host.questions.every((_, i) => host.isQuestionAnswered(i));
  const submitTab = host.tabBar.createSpan({ cls: 'pivi-ask-tab' });
  submitTab.createSpan({ text: allAnswered ? '\u2713 ' : '', cls: 'pivi-ask-tab-submit-check' });
  submitTab.createSpan({ text: t('chat.askUser.submit'), cls: 'pivi-ask-tab-label' });
  if (host.activeTabIndex === host.questions.length) submitTab.addClass('is-active');
  submitTab.addEventListener('click', () => host.switchTab(host.questions.length));
  host.tabElements.push(submitTab);
}

function renderQuestionTab(host: InlineAskUserQuestionHost, idx: number): void {
  const q = host.questions[idx];
  if (!q) return;
  const isMulti = q.multiSelect;
  const selected = host.answers.get(idx)!;

  host.contentArea.createDiv({
    text: q.question,
    cls: 'pivi-ask-question-text',
  });

  const listEl = host.contentArea.createDiv({ cls: 'pivi-ask-list' });

  for (let optIdx = 0; optIdx < q.options.length; optIdx++) {
    const option = q.options[optIdx];
    if (!option) continue;
    const isFocused = optIdx === host.focusedItemIndex;
    const optionValue = host.getOptionValue(option);
    const isSelected = selected.has(optionValue);

    const row = listEl.createDiv({ cls: 'pivi-ask-item' });
    if (isFocused) row.addClass('is-focused');
    if (isSelected) row.addClass('is-selected');

    row.createSpan({ text: isFocused ? '\u203A' : '\u00A0', cls: 'pivi-ask-cursor' });
    row.createSpan({ text: `${optIdx + 1}. `, cls: 'pivi-ask-item-num' });

    if (isMulti) {
      renderMultiSelectCheckbox(row, isSelected);
    }

    const labelBlock = row.createDiv({ cls: 'pivi-ask-item-content' });
    const labelRow = labelBlock.createDiv({ cls: 'pivi-ask-label-row' });
    labelRow.createSpan({ text: option.label, cls: 'pivi-ask-item-label' });

    if (!isMulti && isSelected) {
      labelRow.createSpan({ text: ' \u2713', cls: 'pivi-ask-check-mark' });
    }

    if (option.description) {
      labelBlock.createDiv({ text: option.description, cls: 'pivi-ask-item-desc' });
    }

    row.addEventListener('click', () => {
      host.focusedItemIndex = optIdx;
      updateFocusIndicator(host);
      host.selectOption(idx, option);
    });

    host.currentItems.push(row);
  }

  if (host.canShowCustomInputForQuestion(q)) {
    const customIdx = q.options.length;
    const customFocused = customIdx === host.focusedItemIndex;
    const customText = host.customInputs.get(idx) ?? '';
    const hasCustomText = customText.trim().length > 0;

    const customRow = listEl.createDiv({ cls: 'pivi-ask-item pivi-ask-custom-item' });
    if (customFocused) customRow.addClass('is-focused');

    customRow.createSpan({ text: customFocused ? '\u203A' : '\u00A0', cls: 'pivi-ask-cursor' });
    customRow.createSpan({ text: `${customIdx + 1}. `, cls: 'pivi-ask-item-num' });

    if (isMulti) {
      renderMultiSelectCheckbox(customRow, hasCustomText);
    }

    const inputEl = customRow.createEl('input', {
      cls: 'pivi-ask-custom-text',
      value: customText,
    });
    inputEl.setAttribute('type', q.isSecret ? 'password' : 'text');
    inputEl.setAttribute('placeholder', q.isSecret ? t('chat.askUser.enterSecret') : t('chat.askUser.typeSomething'));

    inputEl.addEventListener('input', () => {
      host.customInputs.set(idx, inputEl.value);
      if (!isMulti && inputEl.value.trim()) {
        selected.clear();
        updateOptionVisuals(host, idx);
      }
      updateTabIndicators(host);
    });
    inputEl.addEventListener('focus', () => {
      host.isInputFocused = true;
    });
    inputEl.addEventListener('blur', () => {
      host.isInputFocused = false;
    });

    customRow.addEventListener('click', () => {
      host.focusedItemIndex = customIdx;
      updateFocusIndicator(host);
      inputEl.focus();
    });

    host.currentItems.push(customRow);
  }

  host.contentArea.createDiv({
    text: host.config.immediateSelect ? HINTS_TEXT_IMMEDIATE : HINTS_TEXT,
    cls: 'pivi-ask-hints',
  });
}

function renderSubmitTab(host: InlineAskUserQuestionHost): void {
  host.contentArea.createDiv({
    text: t('chat.askUser.reviewAnswers'),
    cls: 'pivi-ask-review-title',
  });

  const reviewEl = host.contentArea.createDiv({ cls: 'pivi-ask-review' });

  for (let idx = 0; idx < host.questions.length; idx++) {
    const q = host.questions[idx];
    if (!q) continue;
    const answerText = getAnswerText(host, idx);

    const pairEl = reviewEl.createDiv({ cls: 'pivi-ask-review-pair' });
    pairEl.createDiv({ text: `${idx + 1}.`, cls: 'pivi-ask-review-num' });
    const bodyEl = pairEl.createDiv({ cls: 'pivi-ask-review-body' });
    bodyEl.createDiv({ text: q.question, cls: 'pivi-ask-review-q-text' });
    bodyEl.createDiv({
      text: answerText || t('chat.askUser.notAnswered'),
      cls: answerText ? 'pivi-ask-review-a-text' : 'pivi-ask-review-empty',
    });
    pairEl.addEventListener('click', () => host.switchTab(idx));
  }

  host.contentArea.createDiv({
    text: t('chat.askUser.readyToSubmit'),
    cls: 'pivi-ask-review-prompt',
  });

  const actionsEl = host.contentArea.createDiv({ cls: 'pivi-ask-list' });
  const allAnswered = host.questions.every((_, i) => host.isQuestionAnswered(i));

  const submitRow = actionsEl.createDiv({ cls: 'pivi-ask-item' });
  if (host.focusedItemIndex === 0) submitRow.addClass('is-focused');
  if (!allAnswered) submitRow.addClass('is-disabled');
  submitRow.createSpan({ text: host.focusedItemIndex === 0 ? '\u203A' : '\u00A0', cls: 'pivi-ask-cursor' });
  submitRow.createSpan({ text: '1. ', cls: 'pivi-ask-item-num' });
  submitRow.createSpan({ text: t('chat.askUser.submitAnswers'), cls: 'pivi-ask-item-label' });
  submitRow.addEventListener('click', () => {
    host.focusedItemIndex = 0;
    updateFocusIndicator(host);
    host.handleSubmit();
  });
  host.currentItems.push(submitRow);

  const cancelRow = actionsEl.createDiv({ cls: 'pivi-ask-item' });
  if (host.focusedItemIndex === 1) cancelRow.addClass('is-focused');
  cancelRow.createSpan({ text: host.focusedItemIndex === 1 ? '\u203A' : '\u00A0', cls: 'pivi-ask-cursor' });
  cancelRow.createSpan({ text: '2. ', cls: 'pivi-ask-item-num' });
  cancelRow.createSpan({ text: t('common.cancel'), cls: 'pivi-ask-item-label' });
  cancelRow.addEventListener('click', () => {
    host.focusedItemIndex = 1;
    host.handleResolve(null);
  });
  host.currentItems.push(cancelRow);

  host.contentArea.createDiv({
    text: HINTS_TEXT,
    cls: 'pivi-ask-hints',
  });
}

export function renderTabContent(host: InlineAskUserQuestionHost): void {
  host.contentArea.empty();
  host.currentItems = [];

  if (host.activeTabIndex < host.questions.length) {
    renderQuestionTab(host, host.activeTabIndex);
  } else {
    renderSubmitTab(host);
  }
}

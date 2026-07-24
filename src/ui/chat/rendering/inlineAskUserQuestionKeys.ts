import type { AskUserQuestionItem } from '@pivi/pivi-agent-core/foundation/tools';

import { updateFocusIndicator } from './inlineAskUserQuestionRender';
import type { InlineAskUserQuestionHost } from './inlineAskUserQuestionTypes';

function isEditableElement(element: Element | null): element is HTMLElement {
  if (!(element instanceof HTMLElement)) return false;
  if (element.isContentEditable) return true;
  return element.matches('textarea, input, select, [contenteditable="true"]');
}

export function shouldFocusAskUserRoot(ownerDocument: Document): boolean {
  const active = ownerDocument.activeElement;
  if (!active || active === ownerDocument.body) return true;
  return !isEditableElement(active);
}

function blurActiveElement(host: InlineAskUserQuestionHost): void {
  (host.rootEl.ownerDocument.activeElement as HTMLElement | null)?.blur();
}

function exitInputFocus(host: InlineAskUserQuestionHost): void {
  host.isInputFocused = false;
  blurActiveElement(host);
}

export function handleInputFocusedKeyDown(host: InlineAskUserQuestionHost, e: KeyboardEvent): boolean {
  if (!host.isInputFocused) return false;

  if (e.key === 'Escape') {
    e.preventDefault();
    e.stopPropagation();
    host.isInputFocused = false;
    blurActiveElement(host);
    host.rootEl.focus();
    return true;
  }
  if (e.key === 'Tab' || e.key === 'Enter') {
    e.preventDefault();
    e.stopPropagation();
    exitInputFocus(host);
    if (e.key === 'Tab' && e.shiftKey) {
      host.switchTab(host.activeTabIndex - 1);
    } else {
      host.switchTab(host.activeTabIndex + 1);
    }
    return true;
  }
  if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
    e.preventDefault();
    e.stopPropagation();
    exitInputFocus(host);
    const q = host.questions[host.activeTabIndex];
    if (!q) return true;
    const maxIdx = host.canShowCustomInputForQuestion(q) ? q.options.length : q.options.length - 1;
    if (e.key === 'ArrowUp') {
      host.focusedItemIndex = Math.max(host.focusedItemIndex - 1, 0);
    } else {
      host.focusedItemIndex = Math.min(host.focusedItemIndex + 1, maxIdx);
    }
    updateFocusIndicator(host);
    host.rootEl.focus();
    return true;
  }
  return true;
}

export function handleNavigationKey(
  host: InlineAskUserQuestionHost,
  e: KeyboardEvent,
  maxFocusIndex: number,
): boolean {
  switch (e.key) {
    case 'ArrowDown':
      e.preventDefault();
      e.stopPropagation();
      host.focusedItemIndex = Math.min(host.focusedItemIndex + 1, maxFocusIndex);
      updateFocusIndicator(host);
      return true;
    case 'ArrowUp':
      e.preventDefault();
      e.stopPropagation();
      host.focusedItemIndex = Math.max(host.focusedItemIndex - 1, 0);
      updateFocusIndicator(host);
      return true;
    case 'ArrowLeft':
      if (host.config.immediateSelect) return false;
      e.preventDefault();
      e.stopPropagation();
      host.switchTab(host.activeTabIndex - 1);
      return true;
    case 'Tab':
      if (host.config.immediateSelect) return false;
      e.preventDefault();
      e.stopPropagation();
      if (e.shiftKey) {
        host.switchTab(host.activeTabIndex - 1);
      } else {
        host.switchTab(host.activeTabIndex + 1);
      }
      return true;
    case 'Escape':
      e.preventDefault();
      e.stopPropagation();
      host.handleResolve(null);
      return true;
    default:
      return false;
  }
}

function handleImmediateSelectKeyDown(host: InlineAskUserQuestionHost, e: KeyboardEvent): void {
  const q = host.questions[host.activeTabIndex];
  if (!q) return;
  const maxIdx = q.options.length - 1;
  if (handleNavigationKey(host, e, maxIdx)) return;
  if (e.key === 'Enter') {
    e.preventDefault();
    e.stopPropagation();
    if (host.focusedItemIndex <= maxIdx) {
      const option = q.options[host.focusedItemIndex];
      if (option) host.selectOption(host.activeTabIndex, option);
    }
  }
}

function handleDigitShortcut(host: InlineAskUserQuestionHost, e: KeyboardEvent): boolean {
  if (e.isComposing || host.isInputFocused) return false;
  const active = host.rootEl.ownerDocument.activeElement;
  if (isEditableElement(active)) return false;
  if (active !== host.rootEl && !host.rootEl.contains(active)) return false;
  const digit = Number(e.key);
  if (!Number.isInteger(digit) || digit < 1 || digit > 9) return false;

  if (host.activeTabIndex === host.questions.length) {
    if (digit === 1) {
      e.preventDefault();
      e.stopPropagation();
      host.focusedItemIndex = 0;
      host.handleSubmit();
      return true;
    }
    if (digit === 2) {
      e.preventDefault();
      e.stopPropagation();
      host.handleResolve(null);
      return true;
    }
    return false;
  }

  const q = host.questions[host.activeTabIndex];
  if (!q) return false;
  const optionIndex = digit - 1;
  if (optionIndex < q.options.length) {
    e.preventDefault();
    e.stopPropagation();
    host.focusedItemIndex = optionIndex;
    updateFocusIndicator(host);
    const option = q.options[optionIndex];
    if (option) host.selectOption(host.activeTabIndex, option);
    return true;
  }
  if (host.canShowCustomInputForQuestion(q) && optionIndex === q.options.length) {
    e.preventDefault();
    e.stopPropagation();
    host.focusedItemIndex = optionIndex;
    updateFocusIndicator(host);
    host.isInputFocused = true;
    const customRow = host.currentItems[optionIndex];
    const input = customRow?.querySelector('.pivi-ask-custom-text') as HTMLInputElement | null;
    input?.focus();
    return true;
  }
  return false;
}

function handleSubmitTabEnter(host: InlineAskUserQuestionHost, e: KeyboardEvent): void {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  e.stopPropagation();
  if (host.focusedItemIndex === 0) host.handleSubmit();
  else host.handleResolve(null);
}

function handleQuestionTabKeys(host: InlineAskUserQuestionHost, e: KeyboardEvent, q: AskUserQuestionItem): void {
  switch (e.key) {
    case 'ArrowRight':
      e.preventDefault();
      e.stopPropagation();
      host.switchTab(host.activeTabIndex + 1);
      break;
    case 'Enter':
      e.preventDefault();
      e.stopPropagation();
      if (host.focusedItemIndex < q.options.length) {
        const option = q.options[host.focusedItemIndex];
        if (option) host.selectOption(host.activeTabIndex, option);
      } else if (host.canShowCustomInputForQuestion(q)) {
        host.isInputFocused = true;
        const customRow = host.currentItems[host.focusedItemIndex];
        const input = customRow?.querySelector('.pivi-ask-custom-text') as HTMLInputElement;
        input?.focus();
      }
      break;
    default:
      break;
  }
}

function handleTabbedKeyDown(host: InlineAskUserQuestionHost, e: KeyboardEvent): void {
  const isSubmitTab = host.activeTabIndex === host.questions.length;
  if (isSubmitTab) {
    if (handleNavigationKey(host, e, 1)) return;
    handleSubmitTabEnter(host, e);
    return;
  }

  const q = host.questions[host.activeTabIndex];
  if (!q) return;
  const maxFocusIndex = host.canShowCustomInputForQuestion(q)
    ? q.options.length
    : q.options.length - 1;
  if (handleNavigationKey(host, e, maxFocusIndex)) return;
  handleQuestionTabKeys(host, e, q);
}

export function handleKeyDown(host: InlineAskUserQuestionHost, e: KeyboardEvent): void {
  if (handleInputFocusedKeyDown(host, e)) return;
  if (handleDigitShortcut(host, e)) return;
  if (host.config.immediateSelect) {
    handleImmediateSelectKeyDown(host, e);
    return;
  }
  handleTabbedKeyDown(host, e);
}

export function createInlineAskKeyDownHandler(
  host: InlineAskUserQuestionHost,
): (e: KeyboardEvent) => void {
  return (event) => handleKeyDown(host, event);
}
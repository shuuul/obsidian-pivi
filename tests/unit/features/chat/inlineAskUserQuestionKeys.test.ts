/** @jest-environment jsdom */

import {
  handleKeyDown,
  shouldFocusAskUserRoot,
} from '@/ui/chat/rendering/inlineAskUserQuestionKeys';
import type { InlineAskUserQuestionHost } from '@/ui/chat/rendering/inlineAskUserQuestionTypes';

function createHost(overrides: Partial<InlineAskUserQuestionHost> = {}): InlineAskUserQuestionHost {
  const rootEl = document.createElement('div');
  rootEl.tabIndex = 0;
  document.body.appendChild(rootEl);
  return {
    config: {
      title: 'Question',
      showCustomInput: true,
      immediateSelect: false,
    },
    questions: [{
      question: 'Pick one',
      header: 'Q1',
      options: [{ label: 'Alpha', description: '' }, { label: 'Beta', description: '' }],
      multiSelect: false,
    }],
    answers: new Map([[0, new Set<string>()]]),
    customInputs: new Map([[0, '']]),
    activeTabIndex: 0,
    focusedItemIndex: 0,
    isInputFocused: false,
    tabBar: document.createElement('div'),
    contentArea: document.createElement('div'),
    tabElements: [],
    currentItems: [],
    rootEl,
    isQuestionAnswered: () => false,
    switchTab: jest.fn(),
    selectOption: jest.fn(),
    getOptionValue: option => option.label,
    getSelectedLabels: () => [],
    canShowCustomInputForQuestion: () => false,
    handleSubmit: jest.fn(),
    handleResolve: jest.fn(),
    ...overrides,
  };
}

describe('shouldFocusAskUserRoot', () => {
  it('returns false when a text input owns focus', () => {
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    expect(shouldFocusAskUserRoot(document)).toBe(false);
    input.remove();
  });

  it('returns true when focus is on the document body', () => {
    document.body.focus();
    expect(shouldFocusAskUserRoot(document)).toBe(true);
  });
});

describe('inline ask-user digit shortcuts', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('selects numbered options when the root owns focus', () => {
    const host = createHost();
    host.rootEl.focus();
    const event = new KeyboardEvent('keydown', { key: '2', bubbles: true });
    const preventDefault = jest.spyOn(event, 'preventDefault');
    const stopPropagation = jest.spyOn(event, 'stopPropagation');

    handleKeyDown(host, event);

    expect(preventDefault).toHaveBeenCalled();
    expect(stopPropagation).toHaveBeenCalled();
    expect(host.focusedItemIndex).toBe(1);
    expect(host.selectOption).toHaveBeenCalledWith(0, expect.objectContaining({ label: 'Beta' }));
  });

  it('ignores digit shortcuts while a text input owns focus', () => {
    const host = createHost({ isInputFocused: true });
    const input = document.createElement('input');
    host.rootEl.appendChild(input);
    input.focus();

    const event = new KeyboardEvent('keydown', { key: '1', bubbles: true });
    handleKeyDown(host, event);

    expect(host.selectOption).not.toHaveBeenCalled();
  });

  it('ignores digit shortcuts during IME composition', () => {
    const host = createHost();
    host.rootEl.focus();
    const event = new KeyboardEvent('keydown', { key: '1', bubbles: true });
    Object.defineProperty(event, 'isComposing', { value: true });

    handleKeyDown(host, event);

    expect(host.selectOption).not.toHaveBeenCalled();
  });
});

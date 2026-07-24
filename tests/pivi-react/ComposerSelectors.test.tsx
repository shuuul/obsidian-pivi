import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';

import { createI18n, I18nProvider } from '@pivi/pivi-react';
import { ModelSelector, ThinkingSelector } from '../../packages/pivi-react/src/mount/composer/ComposerSelectors';
import type { ComposerOptionSnapshot } from '@pivi/pivi-react/store';

import { withTestPresentationPlatform } from '../helpers/presentationPlatform';

const modelOptions: ComposerOptionSnapshot[] = [
  { value: 'model-a', label: 'Model A' },
  { value: 'model-b', label: 'Model B' },
  { value: 'model-c', label: 'Model C' },
];

const thinkingOptions: ComposerOptionSnapshot[] = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
];

function renderModelSelector({
  portalRoot,
  value = 'model-a',
}: {
  portalRoot?: HTMLElement;
  value?: string;
} = {}) {
  const onChange = jest.fn();
  render(withTestPresentationPlatform(
    <I18nProvider i18n={createI18n()}>
      <ModelSelector onChange={onChange} options={modelOptions} portalRoot={portalRoot} value={value} />
    </I18nProvider>,
  ));
  return { onChange };
}

function renderThinkingSelector({
  portalRoot,
  value = 'low',
}: {
  portalRoot?: HTMLElement;
  value?: string;
} = {}) {
  const onChange = jest.fn();
  render(withTestPresentationPlatform(
    <I18nProvider i18n={createI18n()}>
      <ThinkingSelector
        adaptive
        defaultValue="medium"
        onChange={onChange}
        options={thinkingOptions}
        portalRoot={portalRoot}
        value={value}
      />
    </I18nProvider>,
  ));
  return { onChange };
}

function openModelSelector(): HTMLElement {
  const trigger = screen.getByRole('button', { name: 'Model' });
  fireEvent.click(trigger);
  return trigger;
}

function openThinkingSelector(): HTMLElement {
  const trigger = screen.getByRole('button', { name: 'Reasoning' });
  fireEvent.click(trigger);
  return trigger;
}

function getModelListbox(): HTMLElement {
  return screen.getByRole('listbox', { name: 'Model' });
}

function getThinkingListbox(): HTMLElement {
  return screen.getByRole('listbox', { name: 'Reasoning' });
}

describe('ComposerSelectors listbox keyboard semantics', () => {
  afterEach(() => {
    cleanup();
  });

  it('exposes listbox and option semantics for model and thinking selectors', () => {
    renderModelSelector();
    openModelSelector();
    const listbox = getModelListbox();
    const options = within(listbox).getAllByRole('option');
    expect(options).toHaveLength(3);
    expect(options.map(option => option.getAttribute('aria-selected'))).toEqual(['false', 'false', 'true']);
    expect(options[2]).toHaveClass('is-highlighted');

    renderThinkingSelector();
    openThinkingSelector();
    const thinkingListbox = getThinkingListbox();
    const thinkingOptionEls = within(thinkingListbox).getAllByRole('option');
    expect(thinkingOptionEls).toHaveLength(3);
    expect(thinkingOptionEls[2]?.getAttribute('aria-selected')).toBe('true');
  });

  it('closes on Escape and restores trigger focus for both selectors', () => {
    renderModelSelector();
    const modelTrigger = openModelSelector();
    expect(modelTrigger).toHaveAttribute('aria-expanded', 'true');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(modelTrigger).toHaveAttribute('aria-expanded', 'false');
    expect(modelTrigger).toHaveFocus();

    renderThinkingSelector();
    const thinkingTrigger = openThinkingSelector();
    expect(thinkingTrigger).toHaveAttribute('aria-expanded', 'true');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(thinkingTrigger).toHaveAttribute('aria-expanded', 'false');
    expect(thinkingTrigger).toHaveFocus();
  });

  it('moves the active option with Arrow, Home, and End and wraps at the ends', () => {
    renderModelSelector();
    openModelSelector();
    const listbox = getModelListbox();
    const options = () => within(listbox).getAllByRole('option');

    fireEvent.keyDown(document, { key: 'ArrowDown' });
    expect(options()[0]).toHaveClass('is-highlighted');
    fireEvent.keyDown(document, { key: 'End' });
    expect(options()[2]).toHaveClass('is-highlighted');
    fireEvent.keyDown(document, { key: 'ArrowDown' });
    expect(options()[0]).toHaveClass('is-highlighted');
    fireEvent.keyDown(document, { key: 'ArrowUp' });
    expect(options()[2]).toHaveClass('is-highlighted');
    fireEvent.keyDown(document, { key: 'Home' });
    expect(options()[0]).toHaveClass('is-highlighted');
  });

  it('selects the active option on Enter', () => {
    const { onChange } = renderModelSelector();
    openModelSelector();
    fireEvent.keyDown(document, { key: 'ArrowDown' });
    fireEvent.keyDown(document, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith('model-c');
    expect(screen.getByRole('button', { name: 'Model' })).toHaveAttribute('aria-expanded', 'false');
  });

  it('dismisses on outside pointer in the sidebar composer', () => {
    const { onChange } = renderModelSelector();
    const trigger = openModelSelector();
    fireEvent.pointerDown(document.body);
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('dismisses on outside pointer when portaled', () => {
    const portalRoot = document.createElement('div');
    document.body.appendChild(portalRoot);
    const { onChange } = renderModelSelector({ portalRoot });
    const trigger = openModelSelector();
    expect(getModelListbox().parentElement).toBe(portalRoot);
    fireEvent.pointerDown(document.body);
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(onChange).not.toHaveBeenCalled();
    portalRoot.remove();
  });

  it('applies the same keyboard contract to the thinking selector', () => {
    const { onChange } = renderThinkingSelector();
    openThinkingSelector();
    fireEvent.keyDown(document, { key: 'ArrowDown' });
    fireEvent.keyDown(document, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith('high');
  });
});

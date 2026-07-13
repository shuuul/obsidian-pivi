import { createContextBadgeViewModel } from '@pivi/obsidian-react/context-badges';
import { setIcon } from 'obsidian';

import { getActiveDocument } from '../dom';
import { appendMcpIcon } from '../utils/icons';
import type { ContextBadgeRenderOptions, ContextBadgeToken } from './ContextBadgeTypes';

function addClasses(el: HTMLElement, classes: string[]): void {
  for (const className of classes) {
    if (className) el.addClass(className);
  }
}

function renderIcon(iconEl: HTMLElement, token: ContextBadgeToken): void {
  const vm = createContextBadgeViewModel(token);
  if (vm.icon.custom === 'mcp') {
    appendMcpIcon(iconEl);
  } else if (vm.icon.name) {
    setIcon(iconEl, vm.icon.name);
  }
}

export function createContextBadgeElement(
  token: ContextBadgeToken,
  options: ContextBadgeRenderOptions = {},
): HTMLElement {
  const vm = createContextBadgeViewModel(token);
  const doc = getActiveDocument(options.root);
  const isInline = options.inline === true;
  const el = isInline ? doc.createElement('span') : doc.createElement('button');

  el.addClass('pivi-context-badge');
  el.addClass(`pivi-context-badge--${vm.tone}`);
  el.addClass(`pivi-context-badge-kind-${vm.kind}`);
  addClasses(el, options.classNames ?? []);

  if (isInline) {
    el.contentEditable = 'false';
    el.dataset.mentionToken = token.token;
  } else {
    el.setAttribute('type', 'button');
    if (vm.disabled === true && !options.onClick) {
      el.setAttribute('disabled', 'true');
    }
  }

  if (vm.tooltip) el.setAttribute('title', vm.tooltip);
  if (vm.ariaLabel) el.setAttribute('aria-label', vm.ariaLabel);

  const iconEl = doc.createElement('span');
  iconEl.className = 'pivi-context-badge-icon';
  renderIcon(iconEl, token);
  el.appendChild(iconEl);

  const labelEl = doc.createElement('span');
  labelEl.className = 'pivi-context-badge-label';
  labelEl.textContent = vm.label;
  el.appendChild(labelEl);

  if (options.onRemove && vm.removable) {
    const removeEl = doc.createElement('span');
    removeEl.className = 'pivi-context-badge-remove';
    removeEl.contentEditable = 'false';
    removeEl.setAttribute('role', 'button');
    removeEl.setAttribute('tabindex', '0');
    removeEl.setAttribute('aria-label', vm.removeAriaLabel ?? 'Remove');
    removeEl.setAttribute('title', vm.removeAriaLabel ?? 'Remove');
    removeEl.textContent = '×';
    const remove = (event: Event) => {
      event.preventDefault();
      event.stopPropagation();
      options.onRemove?.(token, event);
    };
    removeEl.addEventListener('click', remove);
    removeEl.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      remove(event);
    });
    el.appendChild(removeEl);
  }

  if (options.onClick && vm.clickable) {
    el.addClass('pivi-context-badge--clickable');
    el.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      options.onClick?.(token, event);
    });
  }

  return el;
}

export function renderContextBadgeStrip(
  container: HTMLElement,
  tokens: ContextBadgeToken[],
  options: ContextBadgeRenderOptions = {},
): void {
  container.empty();
  if (tokens.length === 0) {
    container.removeClass('pivi-visible-flex');
    container.addClass('pivi-hidden');
    return;
  }
  container.addClass('pivi-visible-flex');
  container.removeClass('pivi-hidden');
  for (const token of tokens) {
    container.appendChild(createContextBadgeElement(token, options));
  }
}

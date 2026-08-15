import { getActiveWindow } from '@/ui/shared/dom';

import type { ComposerInput } from '../mention/composerInputTypes';
import type { DropdownItem } from './slashCommandDropdownData';
import { estimateSlashDropdownWidth } from './slashCommandDropdownMatch';

type SlashInputElement = ComposerInput | HTMLTextAreaElement | HTMLInputElement;

export function getTextOffsetClientRect(inputEl: SlashInputElement, offset: number): DOMRect | null {
  if ('getTextOffsetClientRect' in inputEl && typeof inputEl.getTextOffsetClientRect === 'function') {
    return inputEl.getTextOffsetClientRect(offset);
  }
  return null;
}

export function positionFixedSlashDropdown(
  dropdownEl: HTMLElement,
  inputEl: SlashInputElement,
  containerEl: HTMLElement,
  items: readonly DropdownItem[],
  triggerStartIndex: number,
): void {
  const inputRect = inputEl.getBoundingClientRect();
  const anchorRect = getTextOffsetClientRect(inputEl, triggerStartIndex) ?? inputRect;
  const dropdownWidth = estimateSlashDropdownWidth(items, inputRect.width);
  const left = Math.min(
    Math.max(anchorRect.left, inputRect.left),
    Math.max(inputRect.left, inputRect.right - dropdownWidth),
  );

  dropdownEl.setCssProps({
    '--pivi-fixed-dropdown-bottom': `${getActiveWindow(containerEl).innerHeight - anchorRect.top + 4}px`,
    '--pivi-fixed-dropdown-left': `${left}px`,
    '--pivi-fixed-dropdown-width': `${dropdownWidth}px`,
  });
}

export function positionAnchoredSlashDropdown(
  dropdownEl: HTMLElement,
  inputEl: SlashInputElement,
  containerEl: HTMLElement,
  items: readonly DropdownItem[],
  triggerStartIndex: number,
): void {
  const inputRect = inputEl.getBoundingClientRect();
  const anchorRect = getTextOffsetClientRect(inputEl, triggerStartIndex) ?? inputRect;
  const containerRect = containerEl.getBoundingClientRect();
  const dropdownWidth = estimateSlashDropdownWidth(items, containerRect.width);
  const left = Math.min(
    Math.max(anchorRect.left - containerRect.left, 0),
    Math.max(0, containerRect.width - dropdownWidth),
  );
  const bottom = Math.max(0, containerRect.bottom - anchorRect.top + 4);

  dropdownEl.setCssProps({
    '--pivi-anchored-dropdown-bottom': `${bottom}px`,
    '--pivi-anchored-dropdown-left': `${left}px`,
    '--pivi-anchored-dropdown-width': `${dropdownWidth}px`,
  });
}

export function positionSlashDetailPanel(
  dropdownEl: HTMLElement,
  detailEl: HTMLElement,
  containerEl: HTMLElement,
): void {
  const selectedEl = dropdownEl.querySelector<HTMLElement>('.pivi-slash-item.selected');
  if (!selectedEl) return;

  const dropdownRect = dropdownEl.getBoundingClientRect();
  const selectedRect = selectedEl.getBoundingClientRect();
  const containerRect = containerEl.getBoundingClientRect();
  const top = Math.max(0, selectedRect.top - dropdownRect.top);
  const availableWidth = Math.max(0, containerRect.right - dropdownRect.right - 6);
  detailEl.setCssProps({
    '--pivi-slash-detail-top': `${top}px`,
    '--pivi-slash-detail-max-width': `${availableWidth}px`,
  });
}

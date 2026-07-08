import { setIcon } from 'obsidian';

export const COLLAPSIBLE_CHEVRON_CLASS = 'pivi-collapsible-chevron';

export interface CollapsibleState {
  isExpanded: boolean;
}

export interface CollapsibleOptions {
  /** Initial expanded state (default: false) */
  initiallyExpanded?: boolean;
  /** Callback when state changes */
  onToggle?: (isExpanded: boolean) => void;
  /** Base label for aria-label (will append "click to expand/collapse") */
  baseAriaLabel?: string;
}

function prepareCollapsibleHeader(headerEl: HTMLElement): void {
  headerEl.setAttribute('tabindex', '0');
  headerEl.setAttribute('role', 'button');
}

function ensureChevron(headerEl: HTMLElement): HTMLElement {
  let chevronEl = headerEl.querySelector<HTMLElement>(`.${COLLAPSIBLE_CHEVRON_CLASS}`);
  if (!chevronEl) {
    chevronEl = headerEl.createSpan({ cls: COLLAPSIBLE_CHEVRON_CLASS });
    chevronEl.setAttribute('aria-hidden', 'true');
  }
  return chevronEl;
}

function syncChevron(chevronEl: HTMLElement | null, isExpanded: boolean): void {
  if (!chevronEl) return;
  setIcon(chevronEl, 'chevron-down');
  if (isExpanded) {
    chevronEl.removeClass('is-collapsed');
  } else {
    chevronEl.addClass('is-collapsed');
  }
}

function updateAriaLabel(headerEl: HTMLElement, baseAriaLabel: string | undefined, isExpanded: boolean): void {
  if (!baseAriaLabel) return;
  const action = isExpanded ? 'click to collapse' : 'click to expand';
  headerEl.setAttribute('aria-label', `${baseAriaLabel} - ${action}`);
}

function syncCollapsibleState(
  wrapperEl: HTMLElement,
  headerEl: HTMLElement,
  contentEl: HTMLElement,
  state: CollapsibleState,
  isExpanded: boolean,
  chevronEl: HTMLElement | null,
  baseAriaLabel?: string,
): void {
  state.isExpanded = isExpanded;
  if (isExpanded) {
    wrapperEl.addClass('expanded');
    contentEl.removeClass('pivi-hidden');
  } else {
    wrapperEl.removeClass('expanded');
    contentEl.addClass('pivi-hidden');
  }
  headerEl.setAttribute('aria-expanded', isExpanded ? 'true' : 'false');
  syncChevron(chevronEl, isExpanded);
  updateAriaLabel(headerEl, baseAriaLabel, isExpanded);
}

/**
 * Setup collapsible behavior on a header/content pair.
 *
 * Handles:
 * - Click to toggle
 * - Enter/Space keyboard navigation
 * - aria-expanded attribute
 * - CSS 'expanded' class on wrapper
 * - content display style
 *
 * @param wrapperEl - The wrapper element to add/remove 'expanded' class
 * @param headerEl - The clickable header element
 * @param contentEl - The content element to show/hide
 * @param state - State object to track isExpanded (mutated by this function)
 * @param options - Optional configuration
 */
export function setupCollapsible(
  wrapperEl: HTMLElement,
  headerEl: HTMLElement,
  contentEl: HTMLElement,
  state: CollapsibleState,
  options: CollapsibleOptions = {}
): void {
  const { initiallyExpanded = false, onToggle, baseAriaLabel } = options;

  wrapperEl.addClass('pivi-collapsible');
  prepareCollapsibleHeader(headerEl);

  const chevronEl = ensureChevron(headerEl);

  // Set initial state
  syncCollapsibleState(
    wrapperEl,
    headerEl,
    contentEl,
    state,
    initiallyExpanded,
    chevronEl,
    baseAriaLabel,
  );

  // Toggle handler
  const toggleExpand = () => {
    syncCollapsibleState(
      wrapperEl,
      headerEl,
      contentEl,
      state,
      !state.isExpanded,
      chevronEl,
      baseAriaLabel,
    );
    onToggle?.(state.isExpanded);
  };

  // Click handler
  headerEl.addEventListener('click', toggleExpand);

  // Keyboard handler (Enter/Space)
  headerEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      toggleExpand();
    }
  });
}

/**
 * Collapse a collapsible element and sync state.
 * Use this when programmatically collapsing (e.g., on finalize).
 */
export function collapseElement(
  wrapperEl: HTMLElement,
  headerEl: HTMLElement,
  contentEl: HTMLElement,
  state: CollapsibleState
): void {
  const chevronEl = headerEl.querySelector<HTMLElement>(`.${COLLAPSIBLE_CHEVRON_CLASS}`);
  syncCollapsibleState(wrapperEl, headerEl, contentEl, state, false, chevronEl);
}

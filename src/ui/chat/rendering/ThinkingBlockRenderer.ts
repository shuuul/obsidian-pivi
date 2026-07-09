import { t } from '@/i18n';

import { collapseElement, setupCollapsible } from './collapsible';

export type RenderContentFn = (el: HTMLElement, markdown: string) => Promise<void>;

export interface ThinkingBlockState {
  wrapperEl: HTMLElement;
  contentEl: HTMLElement;
  labelEl: HTMLElement;
  content: string;
  startTime: number;
  timerInterval: number | null;
  isExpanded: boolean;
}

export function createThinkingBlock(
  parentEl: HTMLElement,
  renderContent: RenderContentFn
): ThinkingBlockState {
  const wrapperEl = parentEl.createDiv({ cls: 'pivi-thinking-block' });

  // Header (clickable to expand/collapse)
  const header = wrapperEl.createDiv({ cls: 'pivi-thinking-header' });
  header.setAttribute('aria-expanded', 'false');
  header.setAttribute('aria-label', t('chat.stream.thinkingExpandAria'));

  // Label with timer
  const labelEl = header.createSpan({ cls: 'pivi-thinking-label' });
  const startTime = Date.now();
  labelEl.setText(t('chat.stream.thinking', { seconds: 0 }));

  // Start timer interval to update label every second
  const timerInterval = window.setInterval(() => {
    const elapsed = Math.floor((Date.now() - startTime) / 1000);
    labelEl.setText(t('chat.stream.thinking', { seconds: elapsed }));
  }, 1000);

  // Collapsible content (collapsed by default)
  const contentEl = wrapperEl.createDiv({ cls: 'pivi-thinking-content' });

  // Create state object first so toggle can reference it
  const state: ThinkingBlockState = {
    wrapperEl,
    contentEl,
    labelEl,
    content: '',
    startTime,
    timerInterval,
    isExpanded: false,
  };

  // Setup collapsible behavior (handles click, keyboard, ARIA, CSS)
  setupCollapsible(wrapperEl, header, contentEl, state);

  return state;
}

export function finalizeThinkingBlock(state: ThinkingBlockState): number {
  // Stop the timer
  if (state.timerInterval) {
    window.clearInterval(state.timerInterval);
    state.timerInterval = null;
  }

  // Calculate final duration
  const durationSeconds = Math.floor((Date.now() - state.startTime) / 1000);

  // Update label to show final duration (without "...")
  state.labelEl.setText(t('chat.stream.thoughtFor', { seconds: durationSeconds }));

  // Collapse when done and sync state
  const header = state.wrapperEl.querySelector('.pivi-thinking-header');
  if (header) {
    collapseElement(state.wrapperEl, header as HTMLElement, state.contentEl, state);
  }

  return durationSeconds;
}

export function cleanupThinkingBlock(state: ThinkingBlockState | null) {
  if (state?.timerInterval) {
    window.clearInterval(state.timerInterval);
  }
}

export function renderStoredThinkingBlock(
  parentEl: HTMLElement,
  content: string,
  durationSeconds: number | undefined,
  renderContent: RenderContentFn
): HTMLElement {
  const wrapperEl = parentEl.createDiv({ cls: 'pivi-thinking-block' });

  // Header (clickable to expand/collapse)
  const header = wrapperEl.createDiv({ cls: 'pivi-thinking-header' });
  header.setAttribute('aria-label', t('chat.stream.thinkingExpandAria'));

  // Label with duration
  const labelEl = header.createSpan({ cls: 'pivi-thinking-label' });
  const labelText = durationSeconds !== undefined
    ? t('chat.stream.thoughtFor', { seconds: durationSeconds })
    : t('chat.stream.thought');
  labelEl.setText(labelText);

  // Collapsible content
  const contentEl = wrapperEl.createDiv({ cls: 'pivi-thinking-content' });
  void renderContent(contentEl, content).catch(() => {
    contentEl.setText(content);
  });

  // Setup collapsible behavior (handles click, keyboard, ARIA, CSS)
  const state = { isExpanded: false };
  setupCollapsible(wrapperEl, header, contentEl, state);

  return wrapperEl;
}

import { formatDurationMmSs } from '@pivi/pivi-agent-core/context/date';

import { FLAVOR_TEXTS } from '../constants';
import type { ChatState } from '../state/ChatState';

export const THINKING_INDICATOR_DELAY_MS = 400;

export interface StreamThinkingIndicatorDeps {
  state: ChatState;
  updateQueueIndicator: () => void;
  getMessagesEl: () => HTMLElement;
}

export function showThinkingIndicator(
  deps: StreamThinkingIndicatorDeps,
  overrideText?: string,
  overrideCls?: string,
): void {
  const { state } = deps;

  if (!state.currentContentEl) return;

  if (state.thinkingIndicatorTimeout) {
    const timerWindow = state.currentContentEl.ownerDocument.defaultView ?? window;
    state.clearThinkingIndicatorTimeout(timerWindow);
  }

  if (state.currentThinkingState) {
    return;
  }

  if (state.thinkingEl) {
    state.currentContentEl.appendChild(state.thinkingEl);
    deps.updateQueueIndicator();
    return;
  }

  const timerWindow = state.currentContentEl.ownerDocument.defaultView ?? window;
  state.setThinkingIndicatorTimeout(timerWindow.setTimeout(() => {
    state.setThinkingIndicatorTimeout(null, null);
    if (!state.currentContentEl || state.thinkingEl || state.currentThinkingState) return;

    const cls = overrideCls
      ? `pivi-thinking ${overrideCls}`
      : 'pivi-thinking';
    state.thinkingEl = state.currentContentEl.createDiv({ cls });
    const text = overrideText || FLAVOR_TEXTS[Math.floor(Math.random() * FLAVOR_TEXTS.length)];
    state.thinkingEl.createSpan({ text });

    const timerSpan = state.thinkingEl.createSpan({ cls: 'pivi-thinking-hint' });
    const updateTimer = () => {
      if (!state.responseStartTime) return;
      if (!timerSpan.isConnected) {
        if (state.flavorTimerInterval) {
          state.clearFlavorTimerInterval();
        }
        return;
      }
      const elapsedSeconds = Math.floor((performance.now() - state.responseStartTime) / 1000);
      timerSpan.setText(` (esc to interrupt · ${formatDurationMmSs(elapsedSeconds)})`);
    };
    updateTimer();

    if (state.flavorTimerInterval) {
      state.clearFlavorTimerInterval();
    }
    const thinkingWindow = state.currentContentEl.ownerDocument.defaultView ?? timerWindow;
    state.setFlavorTimerInterval(thinkingWindow.setInterval(updateTimer, 1000), thinkingWindow);

  }, THINKING_INDICATOR_DELAY_MS), timerWindow);
}

export function hideThinkingIndicator(deps: StreamThinkingIndicatorDeps): void {
  const { state } = deps;

  if (state.thinkingIndicatorTimeout) {
    const activeWindow = deps.getMessagesEl().ownerDocument.defaultView ?? window;
    state.clearThinkingIndicatorTimeout(activeWindow);
  }

  state.clearFlavorTimerInterval();

  if (state.thinkingEl) {
    state.thinkingEl.remove();
    state.thinkingEl = null;
  }
}
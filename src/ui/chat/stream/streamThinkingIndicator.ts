import { formatDurationMmSs } from '@pivi/pivi-agent-core/context/date';

import { t } from '@/app/i18n';

import { FLAVOR_TEXTS } from '../constants';
import type { ChatState } from '../state/ChatState';

/** React renders streaming progress from ChatUiSnapshot.thinkingIndicator. */
export interface StreamThinkingIndicatorDeps {
  state: ChatState;
  updateQueueIndicator: () => void;
  getMessagesEl: () => HTMLElement;
}

interface ThinkingIndicatorTimers {
  interval: number | null;
  ownerWindow: Window;
}

const timersByState = new WeakMap<ChatState, ThinkingIndicatorTimers>();

function clearIntervalOnly(timers: ThinkingIndicatorTimers): void {
  if (timers.interval === null) return;
  timers.ownerWindow.clearInterval(timers.interval);
  timers.interval = null;
}

function buildElapsedLabel(state: ChatState): string {
  if (state.responseStartTime === null) return '';
  const elapsedSeconds = Math.floor((performance.now() - state.responseStartTime) / 1000);
  return ` (${t('chat.stream.escInterruptDuration', { duration: formatDurationMmSs(elapsedSeconds) })})`;
}

function writeIndicator(
  deps: StreamThinkingIndicatorDeps,
  text: string,
  className: string,
): void {
  const { state } = deps;
  state.uiStore.update({
    thinkingIndicator: {
      text,
      className,
      elapsedLabel: buildElapsedLabel(state),
    },
  });
  deps.updateQueueIndicator();
}

function ensureElapsedInterval(deps: StreamThinkingIndicatorDeps, ownerWindow: Window): void {
  const { state } = deps;
  let timers = timersByState.get(state);
  if (!timers) {
    timers = { interval: null, ownerWindow };
    timersByState.set(state, timers);
  } else {
    timers.ownerWindow = ownerWindow;
  }

  if (timers.interval !== null) return;

  timers.interval = ownerWindow.setInterval(() => {
    const snapshot = state.uiStore.getSnapshot();
    const current = snapshot.thinkingIndicator;
    if (!current) {
      const active = timersByState.get(state);
      if (active) clearIntervalOnly(active);
      return;
    }
    state.uiStore.update({
      thinkingIndicator: {
        text: current.text,
        className: current.className,
        elapsedLabel: buildElapsedLabel(state),
      },
    });
  }, 1000);
}

export function showThinkingIndicator(
  deps: StreamThinkingIndicatorDeps,
  overrideText?: string,
  overrideCls?: string,
): void {
  const { state, getMessagesEl } = deps;
  const ownerWindow = getMessagesEl().ownerDocument.defaultView ?? window;
  let timers = timersByState.get(state);
  if (!timers) {
    timers = { interval: null, ownerWindow };
    timersByState.set(state, timers);
  } else {
    timers.ownerWindow = ownerWindow;
  }

  // Idempotent while already visible: keep text/class and ensure elapsed ticks.
  if (state.uiStore.getSnapshot().thinkingIndicator) {
    ensureElapsedInterval(deps, ownerWindow);
    return;
  }

  const text = overrideText || FLAVOR_TEXTS[Math.floor(Math.random() * FLAVOR_TEXTS.length)] || 'Thinking...';
  const className = overrideCls ? `pivi-thinking ${overrideCls}` : 'pivi-thinking';
  writeIndicator(deps, text, className);
  ensureElapsedInterval(deps, ownerWindow);
}

export function hideThinkingIndicator(deps: StreamThinkingIndicatorDeps): void {
  const { state, getMessagesEl } = deps;
  const ownerWindow = getMessagesEl().ownerDocument.defaultView ?? window;
  const timers = timersByState.get(state);
  if (timers) {
    timers.ownerWindow = ownerWindow;
    clearIntervalOnly(timers);
    timersByState.delete(state);
  }

  if (state.uiStore.getSnapshot().thinkingIndicator !== null) {
    state.uiStore.update({ thinkingIndicator: null });
  }
  deps.updateQueueIndicator();
}

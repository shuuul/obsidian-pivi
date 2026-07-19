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
  retry: RetryIndicatorState | null;
}

interface RetryIndicatorState {
  attempt: number;
  maxAttempts: number;
  retryAt: number;
  previousClassName: string;
  previousText: string;
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

function buildRetryText(retry: RetryIndicatorState): string {
  const remainingMs = retry.retryAt - performance.now();
  if (remainingMs <= 0) {
    return t('chat.stream.retryActive', {
      attempt: retry.attempt,
      maxAttempts: retry.maxAttempts,
    });
  }
  const seconds = Math.ceil(remainingMs / 1000);
  return t('chat.stream.retrying', {
    attempt: retry.attempt,
    maxAttempts: retry.maxAttempts,
    seconds,
  });
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
    timers = { interval: null, ownerWindow, retry: null };
    timersByState.set(state, timers);
  } else {
    timers.ownerWindow = ownerWindow;
  }

  if (timers.interval !== null) return;

  timers.interval = ownerWindow.setInterval(() => {
    const snapshot = state.uiStore.getSnapshot();
    const current = snapshot.thinkingIndicator;
    const active = timersByState.get(state);
    if (!current) {
      if (active) clearIntervalOnly(active);
      return;
    }
    state.uiStore.update({
      thinkingIndicator: {
        text: active?.retry ? buildRetryText(active.retry) : current.text,
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
    timers = { interval: null, ownerWindow, retry: null };
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

export function showRetryIndicator(
  deps: StreamThinkingIndicatorDeps,
  retry: { attempt: number; maxAttempts: number; delayMs: number },
): void {
  showThinkingIndicator(deps);

  const { state, getMessagesEl } = deps;
  const current = state.uiStore.getSnapshot().thinkingIndicator;
  if (!current) return;

  const ownerWindow = getMessagesEl().ownerDocument.defaultView ?? window;
  const timers = timersByState.get(state);
  if (!timers) return;

  const previous = timers.retry ?? {
    previousClassName: current.className,
    previousText: current.text,
  };
  timers.retry = {
    attempt: retry.attempt,
    maxAttempts: retry.maxAttempts,
    retryAt: performance.now() + retry.delayMs,
    previousClassName: previous.previousClassName,
    previousText: previous.previousText,
  };
  timers.ownerWindow = ownerWindow;
  writeIndicator(deps, buildRetryText(timers.retry), current.className);
  ensureElapsedInterval(deps, ownerWindow);
}

export function hideRetryIndicator(
  deps: StreamThinkingIndicatorDeps,
  attempt?: number,
): void {
  const { state } = deps;
  const timers = timersByState.get(state);
  const retry = timers?.retry;
  if (!timers || !retry || (attempt !== undefined && retry.attempt !== attempt)) return;

  timers.retry = null;
  writeIndicator(deps, retry.previousText, retry.previousClassName);
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

import type { ChatMessage } from '../../../pi/types';
import { formatDurationMmSs } from '../../../utils/date';
import { COMPLETION_FLAVOR_WORDS } from '../constants';

export interface CaptureResponseDurationFooterOptions {
  message: ChatMessage;
  responseStartTime: number | null;
  currentContentEl: HTMLElement | null;
  didCancelThisTurn: boolean;
  now?: () => number;
  pickFlavorWord?: () => string;
}

export function captureResponseDurationFooter(
  options: CaptureResponseDurationFooterOptions,
): void {
  if (options.didCancelThisTurn) {
    return;
  }

  const hasCompactBoundary = options.message.contentBlocks?.some(
    block => block.type === 'context_compacted',
  );
  if (hasCompactBoundary) {
    return;
  }

  const durationSeconds = options.responseStartTime
    ? Math.floor(((options.now ?? performance.now.bind(performance))() - options.responseStartTime) / 1000)
    : 0;
  if (durationSeconds <= 0) {
    return;
  }

  const flavorWord = options.pickFlavorWord?.() ?? COMPLETION_FLAVOR_WORDS[
    Math.floor(Math.random() * COMPLETION_FLAVOR_WORDS.length)
  ];
  options.message.durationSeconds = durationSeconds;
  options.message.durationFlavorWord = flavorWord;

  if (!options.currentContentEl) {
    return;
  }

  const footerEl = options.currentContentEl.createDiv({ cls: 'pivi-response-footer' });
  footerEl.createSpan({
    text: `* ${flavorWord} for ${formatDurationMmSs(durationSeconds)}`,
    cls: 'pivi-baked-duration',
  });
}

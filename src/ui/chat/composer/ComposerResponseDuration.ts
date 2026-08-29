import type { ChatMessage } from '@pivi/agent/runtime';
import {
  calculateTokensPerSecond,
  roundTokensPerSecond,
} from '@pivi/agent/runtime/usage';

import { COMPLETION_FLAVOR_WORDS } from '../constants';

export interface CaptureResponseDurationFooterOptions {
  message: ChatMessage;
  responseStartTime: number | null;
  didCancelThisTurn: boolean;
  outputTokens?: number;
  generationElapsedMs?: number;
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
  if (durationSeconds > 0) {
    const flavorWord = options.pickFlavorWord?.() ?? COMPLETION_FLAVOR_WORDS[
      Math.floor(Math.random() * COMPLETION_FLAVOR_WORDS.length)
    ];
    options.message.durationSeconds = durationSeconds;
    options.message.durationFlavorWord = flavorWord;
  }

  const tokensPerSecond = calculateTokensPerSecond(
    options.outputTokens ?? 0,
    options.generationElapsedMs ?? 0,
  );
  if (tokensPerSecond !== null) {
    options.message.tokensPerSecond = roundTokensPerSecond(tokensPerSecond);
  }
}

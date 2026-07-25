import type { UsageInfo } from '@pivi/pivi-agent-core/foundation';
import { formatContextLimit } from '@pivi/pivi-agent-core/foundation/settingsEnv';
import {
  getContextPressureTokens,
  isContextOverLimit,
} from '@pivi/pivi-agent-core/foundation/usage';
import { Notice } from 'obsidian';

import { t } from '@/app/i18n';

export function isCompactCommandText(text: string): boolean {
  return /^\/compact(?:\s|$)/i.test(text.trim());
}

export function isSubmissionBlockedByContextLimit(
  usage: UsageInfo | null | undefined,
  text: string,
): boolean {
  return isContextOverLimit(usage) && !isCompactCommandText(text);
}

/**
 * Shows the over-limit notice when the session context exceeds the selected
 * model's window, returning true so ordinary send paths can abort. /compact
 * remains available because it uses the runtime's dedicated recovery path.
 */
export function notifyIfContextOverLimit(
  usage: UsageInfo | null | undefined,
  text = '',
): boolean {
  if (!usage || !isSubmissionBlockedByContextLimit(usage, text)) {
    return false;
  }
  new Notice(t('chat.toolbar.contextOverLimit', {
    tokens: formatContextLimit(getContextPressureTokens(usage)),
    limit: formatContextLimit(usage.contextWindow),
  }), 8000);
  return true;
}

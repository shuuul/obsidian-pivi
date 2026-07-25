import type { UsageInfo } from '@pivi/pivi-agent-core/foundation';
import { formatContextLimit } from '@pivi/pivi-agent-core/foundation/settingsEnv';
import { isContextOverLimit } from '@pivi/pivi-agent-core/foundation/usage';
import { Notice } from 'obsidian';

import { t } from '@/app/i18n';

/**
 * Shows the over-limit notice when the session context exceeds the selected
 * model's window, returning true so send paths can abort. /compact is blocked
 * as well: the compaction request itself would overflow the model, so the only
 * ways out are a larger-window model or a new session.
 */
export function notifyIfContextOverLimit(usage: UsageInfo | null | undefined): boolean {
  if (!usage || !isContextOverLimit(usage)) {
    return false;
  }
  new Notice(t('chat.toolbar.contextOverLimit', {
    tokens: formatContextLimit(usage.contextTokens),
    limit: formatContextLimit(usage.contextWindow),
  }), 8000);
  return true;
}

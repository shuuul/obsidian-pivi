import { PluginLogger } from '@pivi/agent/logging/pluginLogger';
import { Notice } from 'obsidian';

import { t } from '@/app/i18n';

const logger = new PluginLogger('AppAction');

/**
 * Catch fire-and-forget command/ribbon promises so a rejection is logged and
 * shown as a Notice instead of becoming an unhandled rejection. Callers stay
 * synchronous: Obsidian command callbacks must return void on some paths.
 */
export function runAppAction(
  action: () => Promise<unknown>,
  noticeKey: Parameters<typeof t>[0],
  warnMessage: string,
): void {
  void action().catch((error: unknown) => {
    logger.warn(warnMessage, error);
    new Notice(t(noticeKey));
  });
}

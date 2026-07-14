import { PluginLogger } from '@pivi/pivi-agent-core/foundation/pluginLogger';
import { Notice } from 'obsidian';

import { t } from '@/app/i18n';

export const imperativeChatLogger = new PluginLogger('ImperativeChatAdapter');

export async function runTabAction(
  action: () => Promise<void>,
  noticeKey: Parameters<typeof t>[0],
  warnMessage: string,
): Promise<void> {
  try {
    await action();
  } catch (error) {
    imperativeChatLogger.warn(warnMessage, error);
    new Notice(t(noticeKey));
  }
}

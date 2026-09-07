import type { App } from 'obsidian';
import { Notice, TFolder } from 'obsidian';

import { navigateSlashBadge } from '@/app/hostPlatform';
import { t } from '@/app/i18n';

import type { ContextBadgeToken } from '../context-badge/ContextBadgeTypes';
import { openLinkTarget } from '../utils/fileLink';
import { revealFolderInExplorer } from '../utils/obsidianPrivateApi';
import { revealInlineContext } from './inlineContextNavigation';

/** Shared by composer and transcript; clicking a badge never submits a command. */
export function getMentionBadgeNavigation(app: App, token: ContextBadgeToken): (() => void) | undefined {
  let navigate: (() => Promise<unknown>) | undefined;
  if (token.kind === 'file') navigate = () => openLinkTarget(app, token.path);
  if (token.kind === 'inline-context') navigate = () => revealInlineContext(app, token.context);
  if (token.kind === 'skill') navigate = () => navigateSlashBadge(app, token.commandName);
  if (token.kind === 'folder' && token.source !== 'external') {
    navigate = async () => {
      const folder = app.vault.getAbstractFileByPath(token.path.replace(/\/$/, ''));
      if (!(folder instanceof TFolder) || !await revealFolderInExplorer(app, folder)) {
        new Notice(t('chat.file.openFailed', { path: token.path }));
      }
    };
  }
  if (!navigate) return undefined;
  const action = navigate;
  return () => {
    void action().catch(() => {
      new Notice(t('chat.file.openFailed', { path: token.token }));
    });
  };
}
